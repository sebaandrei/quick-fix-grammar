# Quick Fix Grammar

Select text in any app, press a hotkey, and the text is fixed, shortened, re-toned or translated in place. It uses your own API key (OpenAI, Anthropic, or any OpenAI-compatible endpoint such as OpenRouter, Groq or Ollama).

## Commands

| Command | What it does | Suggested hotkey |
|---|---|---|
| **Fix & Improve** | Fixes spelling and grammar and lightly polishes. The `Level` preference switches between `Fix only` (minimal edits) and `Fix + Improve` (default). | `⇧ ⇧` (double Right Shift) |
| **Shorten** | Makes the text more concise and keeps the meaning. | `⌥ ⌥` |
| **Change Tone** | Pick Professional, Friendly, Casual, Confident or Direct. The last tone you used is listed first. | `⌃ ⌥ T` |
| **Translate** | Toggles English ↔ Romanian automatically, or translates into the configured target language. | `⌃ ⌥ L` |

Hotkeys are not set by the extension. Assign them in Raycast: Settings → Extensions → Quick Fix Grammar. If a hotkey clashes with Raycast's built-in Quick Fix, turn that one off.

## Setup

1. Create an API key with your provider and set a monthly spend limit there. ChatGPT Plus and Claude Pro subscriptions do **not** include API access; API usage is billed separately.
2. Open the extension preferences in Raycast and set:
   - **Provider**: OpenAI, Anthropic or OpenAI-compatible.
   - **API Key**.
   - **Base URL**: only for OpenAI-compatible providers.
   - **Default Model**: optional. Falls back to `gpt-5-mini` (OpenAI) or `claude-haiku-4-5-20251001` (Anthropic). OpenAI-compatible providers should set a model explicitly.
   - **Level** and **English variant** (US/UK).
3. Optionally set a **Model Override** per command, and a **Target Language** for Translate.

For this workload (a few hundred tokens per fix), small models cost cents per month.

## Behaviour and limits

- The selected text is replaced by pasting. Your previous clipboard contents are restored afterwards.
- Input is capped at about 4,000 characters. Empty selections and over-long text show a message and nothing is pasted.
- Any failure (no selection, bad key, rate limit, timeout, network) shows a message and leaves your text untouched.
- Requests time out after 10 seconds.
- The model is told to treat your text as data and to ignore instructions inside it. Models can still make mistakes, so check important text.
- macOS only for now. Works in apps where Raycast can read the selection and paste.

## Privacy

- Your selected text is sent **only** to the provider you configure (the OpenAI or Anthropic API, or the base URL you set). It goes nowhere else, and there is no server run by this extension.
- The extension does not log, store or cache your text or the results.
- The only thing stored locally is the id of the last tone you picked in Change Tone, in Raycast's local storage.
- Your API key is kept in Raycast's preferences (password field).
- Check your provider's own data-retention policy: they may retain API requests for a period.

## Development

```
npm install
npm run dev     # load in Raycast
npm test
npm run lint
npm run build
```

Core logic lives in `src/core` and has no Raycast imports, so it can be reused outside Raycast. `eval/` holds a golden sample set and a benchmark for choosing models:

```
npm run bench -- --models "openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001" --runs 5
npm run bench -- --dry-run
```

See `docs/models.md` for results and `IMPLEMENTATION_PLAN.md` for the plan.

## License

MIT
