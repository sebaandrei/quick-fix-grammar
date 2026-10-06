# Quick Fix Grammar

Select text in any app, press a hotkey, and the text is fixed, shortened, re-toned or translated in place. It uses your own API key (OpenRouter, OpenAI, Anthropic, or any OpenAI-compatible endpoint such as Google's, Groq or Ollama). There is no account, no subscription and no server run by this extension.

## Requirements

- macOS and [Raycast](https://raycast.com)
- An API key from one of the supported providers (see Setup)

## Commands

| Command                  | What it does                                                                                                                                                                      | Suggested hotkey           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Fix and Improve Text** | Fixes spelling and grammar and lightly polishes. The **Fix & Improve Level** preference switches between `Fix only` (minimal edits) and `Fix + Improve` (default).                | `⇧ ⇧` (double Right Shift) |
| **Shorten Text**         | Makes the text more concise and keeps the meaning.                                                                                                                                | `⌥ ⌥`                      |
| **Change Tone**          | Pick Professional, Friendly, Casual, Confident or Direct. The last tone you used is listed first.                                                                                 | `⌃ ⌥ T`                    |
| **Translate Text**       | Without a target language, English text is translated to Romanian and any other language is translated to English. With a **Target Language** set, translates into that language. | `⌃ ⌥ L`                    |

The extension does not set any hotkeys. Assign your own in Raycast: Settings → Extensions → Quick Fix Grammar. If a hotkey clashes with a built-in Raycast command, turn that one off.

## Setup

1. Create an API key with your provider and set a monthly spend limit there. ChatGPT Plus and Claude Pro subscriptions do **not** include API access; API usage is billed separately.
2. Open the extension preferences in Raycast and set:
   - **Provider**: OpenRouter (default), OpenAI, Anthropic or OpenAI-compatible.
   - **API Key**. Local endpoints such as Ollama do not check the key, but the field is required, so enter any placeholder.
   - **Base URL**: only for the OpenAI-compatible provider, where it is required. The other providers ignore it (OpenRouter always uses `https://openrouter.ai/api/v1`).
   - **Default Model**: optional. If empty, the extension uses `google/gemini-3.1-flash-lite` (OpenRouter), `gpt-5-mini` (OpenAI) or `claude-haiku-4-5-20251001` (Anthropic). The OpenAI-compatible provider also defaults to Gemini 3.1 Flash-Lite on Google's endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`) and needs an explicit model for any other host.
   - **Fix & Improve Level** (`Fix only` or `Fix + Improve`) and **English Variant** (`US` or `UK`).
3. Optionally set a **Model Override** per command, and a **Target Language** for Translate Text.

**Quickest start:** Provider OpenRouter, your OpenRouter key, everything else left at its default.

### Using it

1. Select text in any app.
2. Run a command from Raycast, or press the hotkey you assigned.
3. The selected text is replaced with the result. Change Tone shows a list first: pick a tone and press Enter.

### Cost

A fix sends a few hundred tokens, so with a small model each call costs a small fraction of a cent. The actual cost depends on your provider's current prices and how much you use it, so check the provider's pricing page and keep the spend limit from step 1.

## Behavior and limits

- The selected text is replaced by pasting. Afterwards your previous clipboard contents are restored on a best-effort basis: the restore happens after a short delay (about 0.6 s), can fail, and the confirmation says so when it does. It is skipped if nothing was pasted or if you copied something else in the meantime.
- If you switch to another app while a request runs, nothing is pasted. The result is left on your clipboard instead.
- Input is capped at 4,000 characters. Empty selections and over-long text show a message and nothing is pasted.
- Any failure (no selection, bad key, rate limit, timeout, network) shows a message and leaves your text untouched.
- Requests time out after 10 seconds. A transient failure (network error, 408, 429 or 5xx) is retried once within that same budget. Redirects are not followed, and a response larger than 1 MB is discarded.
- The Base URL of the OpenAI-compatible provider must be `https://`. Plain `http://` is accepted only for localhost, 127.0.0.1, [::1] and `*.local`, and the URL must not contain a username or password, because your key and text are sent there.
- Model answers are cleaned of control, bidi, zero-width and Unicode tag characters, and an answer much longer than the input (over 4 times its length plus 500 characters) is rejected.
- The model is told to treat your text as data and to ignore instructions inside it. Models can still make mistakes, so check important text.
- Works in apps where Raycast can read the selection and paste.

## Troubleshooting

| Message or symptom                     | What to do                                                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication error                   | The API key is wrong or does not match the Provider. Check both in the extension preferences.                                                                                                                                                        |
| Billing or quota error                 | Add credit or raise the spend limit at your provider.                                                                                                                                                                                                |
| Rate limited                           | Wait a moment and try again, or pick another model.                                                                                                                                                                                                  |
| Timed out                              | The provider or model is slow. Try again, or set a faster model in Default Model.                                                                                                                                                                    |
| Nothing selected                       | Select text first. Some apps do not expose their selection to Raycast; try copying manually and using another app.                                                                                                                                   |
| Result is on the clipboard, not pasted | You switched apps while the request ran. Paste it yourself with `⌘ V`.                                                                                                                                                                               |
| Base URL is rejected                   | Use an `https://` URL without a username or password. `http://` works only for localhost.                                                                                                                                                            |
| Unknown model or request error         | The model id is not available at that provider. Check the spelling in Default Model or Model Override. With OpenRouter, OpenAI, Anthropic or Google you can clear it to use the built-in default; other OpenAI-compatible hosts always need a model. |

## Privacy

- Your selected text is sent **only** to the provider you configure: OpenRouter (`https://openrouter.ai/api/v1`, which forwards it to the model's host, for example Google for Gemini), the OpenAI or Anthropic API, or the Base URL you set for an OpenAI-compatible provider. It goes nowhere else. OpenRouter lets you restrict which hosts see your prompts in your account's data and provider-routing settings.
- The extension does not log or store your text or the results, and has no analytics.
- Reading the selection and pasting the result go through the macOS clipboard. The result is briefly on the clipboard, so the system clipboard and any clipboard manager you run may see it (and may keep it) before your previous contents are restored.
- With the OpenRouter provider (or an OpenAI-compatible base URL on `openrouter.ai`), requests also carry OpenRouter's app-attribution headers (the app name "Quick Fix Grammar" and this project's URL, marked hidden from public rankings) so usage shows under that name in your OpenRouter dashboard. They contain no text from you and are not sent to any other host.
- Error messages shown by the extension can include text from the provider's response.
- Besides your preferences, the only value the extension writes is the id of the last tone you picked in Change Tone, in Raycast's local storage.
- Your API key is kept in Raycast's preferences (password field). Raycast stores preferences and local storage in its own encrypted local database.
- Check your provider's own data-retention policy: they may retain API requests for a period.

## Development

```
npm install
npm run dev     # load in Raycast
npm test
npm run lint
npm run build
```

Core logic lives in `src/core` and has no Raycast imports. `eval/` holds a golden sample set and a benchmark for comparing models:

```
npm run bench -- --dry-run     # fake provider, no keys
npm run bench -- --models "openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001" --runs 5
```

The benchmark reads keys from the environment: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` (for `openrouter:` specs and OpenRouter base URLs) and `OPENAI_COMPATIBLE_API_KEY` (for any other base URL). Models without a key are skipped and listed in the report. See `AGENTS.md` for contributor notes and `SECURITY.md` to report a vulnerability.

## License

MIT
