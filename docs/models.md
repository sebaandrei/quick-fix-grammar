# Model selection (T17)

> **TEMPLATE: delete this banner when the results below are filled in.**
> Status: not yet benchmarked. Fill in after running the benchmark with real API keys.

## How to run

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export OPENROUTER_API_KEY=...          # OpenRouter base URLs
# export OPENAI_COMPATIBLE_API_KEY=... # any other openai-compatible base URL
npx tsx eval/bench.ts \
  --models "openai:gpt-5-mini,openai:gpt-5-nano,anthropic:claude-haiku-4-5-20251001,openai-compatible@https://openrouter.ai/api/v1:google/gemini-2.5-flash-lite" \
  --runs 5
```

Models whose key is missing are skipped and listed in the report header. A model run stops early after 3 consecutive auth or request errors (bad key, wrong model name).

Results land in `eval/results/<timestamp>.json` and `.md`: a summary table, then the run-1 output of every sample for every model.

Cost is **always an estimate**: the bench has no provider usage data, so tokens are characters / 4 (system prompt plus user text in, output text out), multiplied by the prices in `eval/prices.json`. Those prices are placeholders; edit them first and verify against each provider's pricing page. Models without an entry show `n/a`.

Bench date: `YYYY-MM-DD`. Results file: `eval/results/<timestamp>.json`. Runs per sample: `N`.

## Acceptance criterion

Fix mode, ~100-word input (sample `long-fix-en`, tag `latency-ac`): **p95 latency < 2 s** for the chosen default model. Latency percentiles include errored calls, and the bench marks the verdict `UNRELIABLE` if any `latency-ac` call errored; rerun in that case.

## Sample tags with built-in meaning

`correct` (output must equal the input), `ro-diacritics` (diacritics of the expected text or input must survive; **skipped for translate samples**, where the output language differs), `expect-diacritics` (output must contain a Romanian diacritic), `shorter`, `keep-header` (the input starts with a header line the output must keep, so the preamble check is skipped), `latency-ac` (the sample the 2 s acceptance criterion is measured on), `injection` (informational; its `must`/`mustNot` lists do the work). Details: `eval/lib.ts`.

## Results

Paste the summary table from the bench output (the model column is the exact `--models` entry):

| Model | Pass rate | p50 | p95 | p95 (100-word Fix) | Mean cost/call | Errors | Failing checks |
|---|---|---|---|---|---|---|---|
| openai:gpt-5-mini | | | | | | | |
| openai:gpt-5-nano | | | | | | | |
| anthropic:claude-haiku-4-5-20251001 | | | | | | | |
| openai-compatible@https://openrouter.ai/api/v1:google/gemini-2.5-flash-lite | | | | | | | |

Then paste or link the run-1 output of each sample (the `## Outputs for manual review` section of the `.md` report). Automatic checks do not judge quality, so read them for: tone naturalness, Romanian grammar and diacritics, over-editing of already-correct text, faithfulness of translations, and the injection samples.

## Decision

| Mode | Default model | Why | p95 | Cost/call (estimate) |
|---|---|---|---|---|
| fix-only | | | | |
| fix-improve | | | | |
| shorten | | | | |
| tone-* | | | | |
| translate | | | | |

How to apply a decision (every place a default appears, see `AGENTS.md`):

- `src/core/modes.ts` has a single `OPENAI_DEFAULT_MODEL` shared by every mode. Different defaults per mode need a code change there (for example a per-mode model in `SPECS`), and because modes only know OpenAI model ids, a provider-aware fallback (a `mode()`-level default per provider, or a lookup in `resolve.ts`).
- Anthropic's default is `ANTHROPIC_DEFAULT_MODEL` in `src/raycast/resolve.ts`, not `modes.ts`.
- Update the `defaultModel` placeholder and description in `package.json`, the Setup section of `README.md`, and this file.

## Rejected models

- `model`: reason (latency, diacritics, over-editing, ...)

## Re-evaluate when

- A provider ships a new small model, or prices change.
- Dogfooding (`docs/dogfood.md`) shows repeated failures on a mode.
