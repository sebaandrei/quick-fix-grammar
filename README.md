# Quick Fix Grammar

Select text in any app, press a hotkey, and the text is fixed, shortened, re-toned or translated in place. It uses your own API key (OpenRouter, OpenAI, Anthropic, or any OpenAI-compatible endpoint such as Google's, Groq or Ollama).

## Commands

| Command                  | What it does                                                                                                                                                                      | Suggested hotkey           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Fix and Improve Text** | Fixes spelling and grammar and lightly polishes. The **Fix & Improve Level** preference switches between `Fix only` (minimal edits) and `Fix + Improve` (default).                | `⇧ ⇧` (double Right Shift) |
| **Shorten Text**         | Makes the text more concise and keeps the meaning.                                                                                                                                | `⌥ ⌥`                      |
| **Change Tone**          | Pick Professional, Friendly, Casual, Confident or Direct. The last tone you used is listed first.                                                                                 | `⌃ ⌥ T`                    |
| **Translate Text**       | Without a target language, English text is translated to Romanian and any other language is translated to English. With a **Target Language** set, translates into that language. | `⌃ ⌥ L`                    |

The hotkeys are only suggestions. The extension does not set any, and I have not verified that Raycast accepts a double-tap of a modifier key (`⇧ ⇧`, `⌥ ⌥`) as a hotkey. If it does not, pick another combination. Assign them in Raycast: Settings → Extensions → Quick Fix Grammar. If a hotkey clashes with a built-in Raycast command, turn that one off.

## Setup

1. Create an API key with your provider and set a monthly spend limit there. ChatGPT Plus and Claude Pro subscriptions do **not** include API access; API usage is billed separately.
2. Open the extension preferences in Raycast and set:
   - **Provider**: OpenRouter (default), OpenAI, Anthropic or OpenAI-compatible.
   - **API Key**. Local endpoints such as Ollama do not check the key, but the field is required, so enter any placeholder.
   - **Base URL**: only used with the OpenAI-compatible provider, where it is required; ignored for the others (OpenRouter always uses `https://openrouter.ai/api/v1`).
   - **Default Model**: optional. Falls back to `google/gemini-3.1-flash-lite` (OpenRouter), `gpt-5-mini` (OpenAI) or `claude-haiku-4-5-20251001` (Anthropic). The OpenAI-compatible provider also falls back to Gemini 3.1 Flash-Lite on Google's endpoint `https://generativelanguage.googleapis.com/v1beta/openai/` (`gemini-3.1-flash-lite`) and needs an explicit model for other hosts.
   - **Fix & Improve Level** (`Fix only` or `Fix + Improve`) and **English Variant** (`US` or `UK`).
3. Optionally set a **Model Override** per command, and a **Target Language** for Translate Text.

**Recommended setup:** Provider OpenRouter, your OpenRouter key, and leave Default Model empty. That uses `google/gemini-3.1-flash-lite`, chosen in the benchmark for reliability (no dropped sentences, a stable model) with p95 latency under 1 s (see Model choice below).

For this workload (a few hundred tokens per fix), small models should cost very little, but the cost depends on your provider's current prices and how much you use it. Treat any figure as an estimate and check the provider's pricing page. Model choice below has a rough per-call estimate.

## Behaviour and limits

- The selected text is replaced by pasting. After a paste, your previous clipboard contents are restored on a best-effort basis: the restore happens after a short delay (about 0.6 s), can fail, and the confirmation says so when it does. The restore is not attempted if nothing was pasted.
- Input is capped at 4,000 characters. Empty selections and over-long text show a message and nothing is pasted.
- Any failure (no selection, bad key, rate limit, timeout, network) shows a message and leaves your text untouched.
- Requests time out after 10 seconds.
- The model is told to treat your text as data and to ignore instructions inside it. Models can still make mistakes, so check important text.
- macOS only for now. Works in apps where Raycast can read the selection and paste.

## Privacy

- Your selected text is sent **only** to the provider you configure: OpenRouter (`https://openrouter.ai/api/v1`, which forwards it to the model's host, for example Google for Gemini), the OpenAI or Anthropic API, or the Base URL you set for an OpenAI-compatible provider. It goes nowhere else, and there is no server run by this extension. OpenRouter lets you restrict which hosts see your prompts (data and provider-routing settings in your OpenRouter account).
- The extension does not log or store your text or the results, and has no analytics.
- Reading the selection and pasting the result go through the macOS clipboard. The result is briefly on the clipboard, so the system clipboard and any clipboard manager you run may see it (and may keep it) before your previous contents are restored.
- With the OpenRouter provider (or an OpenAI-compatible base URL on `openrouter.ai`), requests also carry OpenRouter's app-attribution headers (the app name "Quick Fix Grammar" and this project's URL, marked hidden from public rankings) so usage shows under that name in your OpenRouter dashboard. They contain no text from you and are not sent to any other host.
- Error messages shown by the extension can include text from the provider's response.
- The only thing the extension stores locally is the id of the last tone you picked in Change Tone, in Raycast's local storage.
- Your API key is kept in Raycast's preferences (password field).
- Check your provider's own data-retention policy: they may retain API requests for a period.

## Model choice

Benchmarked on 2026-10-05 through OpenRouter: 51 samples (English and Romanian fixes, code and markdown, already-correct text, prompt-injection attempts), 2 runs each. Cost is an estimate (characters / 4 tokens at the providers' listed prices) for 3,000 calls a month; check current prices.

| Model                                      | Pass rate | p95 (100-word Fix)           | Est. cost / month |
| ------------------------------------------ | --------- | ---------------------------- | ----------------- |
| **google/gemini-3.1-flash-lite** (default) | 94%       | 0.9 s                        | $0.47             |
| google/gemini-2.5-flash-lite               | 96%       | 0.8 s                        | $0.17             |
| mistralai/mistral-small-2603               | 86%       | 1.0 s                        | $0.26             |
| openai/gpt-4.1-nano                        | 84%       | 4.5 s (fails the 2 s target) | $0.17             |

Gemini 3.1 Flash-Lite is the default for reliability: it kept every sentence on the prompt-injection sample and passed every Romanian sample, and it is a stable model. Gemini 2.5 Flash-Lite scores 2 points higher and is cheaper, but it dropped text on that sample and Google lists it as limited access. Mistral Small followed an injected instruction, and `gpt-4.1-nano` is too slow. All four rewrite typos inside inline code despite the instruction to leave code untouched. Gemini 3.x prices are due to rise on 2027-01-01. The full write-up (failure notes, rejected models, free-model results) was removed from the tree and is in git history (`git log -p -- docs/models.md`). Re-run the benchmark with `npm run bench` when a model or price changes.

## Development

```
npm install
npm run dev     # load in Raycast
npm test
npm run lint
npm run build
```

Core logic lives in `src/core` and has no Raycast imports, which keeps it easy to test and to reuse elsewhere. `eval/` holds a golden sample set and a benchmark for choosing models. The benchmark reads keys from the environment: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` (for `openrouter:` specs and OpenRouter base URLs) and `OPENAI_COMPATIBLE_API_KEY` (for any other base URL). Models whose key is not set are skipped and listed in the report.

```
npm run bench -- --models "openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001" --runs 5
npm run bench -- --dry-run     # fake provider, no keys
```

See `IMPLEMENTATION_PLAN.md` for the plan.

## License

MIT
