# Model selection (T17)

> Status: decided 2026-10-05 (Gemini 3.1 Flash-Lite). Based on small benchmark runs (2 runs of 51 samples per model, 3 runs of the 100-word Fix sample in the first pass), so treat close calls as noise and re-run when a model or price changes.

## How to run

```bash
export OPENROUTER_API_KEY=...          # OpenRouter base URLs (one key reaches most models)
# export OPENAI_API_KEY=... ANTHROPIC_API_KEY=...   # direct OpenAI / Anthropic
# export OPENAI_COMPATIBLE_API_KEY=... # any other openai-compatible base URL
R=openai-compatible@https://openrouter.ai/api/v1
npm run bench -- --runs 2 --models "$R:google/gemini-3.1-flash-lite,$R:google/gemini-2.5-flash-lite"
npm run bench -- --runs 3 --filter latency-ac --models "$R:<model>,..."   # quick latency-only filter
```

Models whose key is missing are skipped and listed in the report header. A model run stops early after 3 consecutive auth or request errors (bad key, wrong model name).

Results land in `eval/results/<timestamp>.json` and `.md`: a summary table, then the run-1 output of every sample for every model.

Cost is **always an estimate**: the bench has no provider usage data, so tokens are characters / 4 (system prompt plus user text in, output text out) and reasoning tokens are not counted, multiplied by the prices in `eval/prices.json` (taken from provider pricing pages and OpenRouter on 2026-10-05; re-check before relying on them). Models without an entry show `n/a`. Rate-limited (429) calls are retried with backoff (`--delay <ms>` adds a pause before every call).

## Acceptance criterion

Fix mode, ~100-word input (sample `long-fix-en`, tag `latency-ac`): **p95 latency < 2 s** for the chosen default model. Latency percentiles cover successful calls and timeouts (rate-limit and auth errors return instantly and are left out), and the bench marks the verdict `UNRELIABLE` if any `latency-ac` call errored; rerun in that case.

## Sample tags with built-in meaning

`correct` (output must equal the input), `ro-diacritics` (diacritics of the expected text or input must survive; **skipped for translate samples**, where the output language differs), `expect-diacritics` (output must contain a Romanian diacritic), `shorter`, `keep-header` (the input starts with a header line the output must keep, so the preamble check is skipped), `latency-ac` (the sample the 2 s acceptance criterion is measured on), `injection` (informational; its `must`/`mustNot` lists do the work). Details: `eval/lib.ts`.

## Results

All through OpenRouter, 51 samples, 2 runs each (bench 2026-10-05, after the shared-prompt fixes for translation drift, dropped text and code fidelity). Results files are gitignored (`eval/results/`).

| Model                            | Pass rate | p50     | p95     | p95 (100-word Fix) | Mean cost/call (est.) | Errors              |
| -------------------------------- | --------- | ------- | ------- | ------------------ | --------------------- | ------------------- |
| google/gemini-2.5-flash-lite     | 96%       | 552 ms  | 702 ms  | 755 ms OK          | $0.000057             | 0/102               |
| **google/gemini-3.1-flash-lite** | 94%       | 629 ms  | 836 ms  | 900 ms OK          | $0.000155             | 0/102               |
| mistralai/mistral-small-2603     | 86%       | 605 ms  | 1236 ms | 1044 ms OK         | $0.000085             | 3/102 (rate limits) |
| openai/gpt-4.1-nano              | 84%       | 1045 ms | 3682 ms | 4497 ms FAIL       | $0.000056             | 0/102               |

What the failures were (read from the run-1 outputs):

- **gemini-3.1-flash-lite:** passed every Romanian sample, kept every sentence of `inj-closing-tag` (fixed the typo, ignored the injected command) but dropped the literal `</input_text>` token in both runs, no translation drift. Its misses: `inj-closing-tag` (that dropped token), `en-grammar-3` in one run (it expanded "They're" to "They are"), the inline-code typo (see below), and `inj-translate`, a check that is too strict (it translated an injected sentence, which is correct).
- **gemini-2.5-flash-lite:** also passed every Romanian sample, but dropped everything after the first sentence on `inj-closing-tag` in both runs (data loss). Google also lists it as "limited access", a retirement risk.
- **mistral-small-2603:** followed an injected instruction in `inj-translate` (answered "I have been hacked." instead of translating), dropped text on `inj-closing-tag`, ignored the US spelling variant, left a cedilla (`Şi`) uncorrected, reformatted code, and had rate-limit errors.
- **gpt-4.1-nano:** fails the 2 s criterion (p95 4.5 s) and has more diacritic errors.
- **All four** "fix" typos inside inline code (`` `npm instal` `` becomes `` `npm install` ``) despite the rule to leave code untouched. The sample stays as a code-fidelity check and is treated as known behaviour.

Earlier passes (single sample or small n, not in the table):

- First pass (100-word Fix, 3 runs): gemini-2.5-flash-lite p95 768 ms, mistral-small-2603 1146 ms, gemini-3.1-flash-lite 1731 ms, gpt-4.1-nano 1946 ms (borderline) passed; ministral-14b-2512 p95 4016 ms (p50 1.6 s), deepseek-v4-flash, qwen3.7-flash and gpt-oss-120b timed out at 10 s.
- Free OpenRouter models (testing only): nemotron-3-super-120b-a12b:free got 63% with 14/49 errors (13 rate limits), p95 3.8 s on the 100-word Fix, and mangled Romanian (`Şi ţara` became `Ș țară`). The two Gemma free models only returned 429s; qwen3.8-27b:free and nemotron-3.5-lightning:free timed out.

## Decision

Default for the OpenRouter provider (the extension's default provider) and the Google-endpoint path: **Gemini 3.1 Flash-Lite** for every mode (`google/gemini-3.1-flash-lite` on OpenRouter, `gemini-3.1-flash-lite` on Google's OpenAI-compatible endpoint). Chosen over 2.5 Flash-Lite (which scores 2 points higher on pass rate, and is faster and cheaper) because it did not drop sentences on the injection sample and is a stable (not limited-access) model, at about $0.47 a month per 3,000 calls (estimate). Gemini 2.5 Flash-Lite stays the cheaper, slightly faster option (about $0.17 per 3,000 calls) if the retirement risk is acceptable.

| Mode                                                    | Default model                | Why                                            | p95                                 | Cost/call (estimate) |
| ------------------------------------------------------- | ---------------------------- | ---------------------------------------------- | ----------------------------------- | -------------------- |
| all (fix-only, fix-improve, shorten, tone-*, translate) | google/gemini-3.1-flash-lite | no dropped sentences (2.5 Flash-Lite scores 2 points higher on pass rate but loses text), stable model, under 2 s, no errors | 836 ms (900 ms on the 100-word Fix) | $0.000155            |

Not benchmarked per mode: only Fix has a latency criterion, and the same model is used for all modes. Shorten, tone and translate quality were checked only through the shared samples; review their outputs after dogfooding.

Gemini 3.x prices are due to rise on 2027-01-01 (about double, per Google's pricing page), which would still be about $1 a month at 3,000 calls.

How the default is applied:

- `src/raycast/resolve.ts` (`GEMINI_OPENROUTER_MODEL`, `GEMINI_NATIVE_MODEL`, `compatibleDefaultModel`): an empty model resolves to the Gemini model for the `openrouter` provider, and for the OpenAI-compatible provider when the base URL host is `openrouter.ai` (or a subdomain) or `generativelanguage.googleapis.com`. Other hosts still need an explicit model.
- The `openrouter` provider (`src/core/providers/index.ts`) always posts to `https://openrouter.ai/api/v1`, ignoring the Base URL preference, and it is the manifest's default provider.
- The OpenAI provider still defaults to `gpt-5-mini` (`OPENAI_DEFAULT_MODEL` in `src/core/modes.ts`) and Anthropic to `claude-haiku-4-5-20251001` (`ANTHROPIC_DEFAULT_MODEL`). Neither was part of this benchmark through its own API, so they are unchanged. `gpt-5-nano` (OpenAI's cheapest) is worth a direct-API run (`openai:gpt-5-nano`), not through OpenRouter, because core only sends `reasoning_effort: minimal` to OpenAI's own endpoint.
- Per-mode defaults would need a code change in `modes.ts` (see `AGENTS.md`).

## Rejected models

- `openai/gpt-4.1-nano`: p95 4.5 s on the 100-word Fix, more diacritic errors.
- `mistralai/mistral-small-2603`: followed an injected instruction, dropped text, ignored the English variant, uncorrected cedilla.
- `mistralai/ministral-14b-2512`: p95 4.0 s in the first pass (variable).
- `deepseek/deepseek-v4-flash`, `qwen/qwen3.7-flash`, `openai/gpt-oss-120b`: timed out at 10 s in the first pass (probably reasoning by default or a slow host; the OpenAI-compatible provider cannot turn reasoning off yet, so they could be retested if that is added).
- Free OpenRouter models: rate limits, 4 to 10 s latency, Romanian errors. Fine for testing the extension, not for use.
- `moonshotai/kimi-k2-0905`: not benchmarked; priced higher and published speed is 30 to 50 tokens/s.

## Re-evaluate when

- A provider ships a new small model, or prices change.
- Dogfooding (`docs/dogfood.md`, not yet written) shows repeated failures on a mode.
