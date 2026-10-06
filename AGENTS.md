# AGENTS.md

Raycast extension (macOS, TypeScript/React): select text in any app, run a command, and the text is fixed, shortened, re-toned or translated in place with the user's own API key. See `README.md` for users and `IMPLEMENTATION_PLAN.md` for the original task list and decisions log (partly stale).

## Commands

```
npm install
npm run dev        # ray develop; needs the Raycast app, loads the extension live
npm test           # vitest (src/**/*.test.ts, eval/**/*.test.ts)
npm run lint       # ray lint = ESLint + Prettier + manifest checks (fix: npm run fix-lint)
npm run build      # ray build -e dist; type-checks. Run before declaring work done
# CI (.github/workflows/ci.yml) runs: npm ci, npm run build, npx eslint ., npx prettier --check ., npm test, npm audit --omit=dev --audit-level=high
npm run bench -- --dry-run                       # eval harness without API keys
npm run bench -- --models "openai:gpt-5-mini" --runs 5   # real run, keys via env
```

Before finishing any change: `npm test && npm run build && npm run lint` must all pass. You cannot run the extension itself without the Raycast app; say so when a change touches the paste or clipboard flow instead of claiming it works.

## Layout

```
src/core/        pure TS, NO @raycast imports (keeps it testable; reuse outside Raycast is a possibility, not a promise)
  providers/     LLMProvider interface (types.ts), openai.ts, anthropic.ts, http.ts, index.ts (createProvider; the `openrouter` provider reuses openai.ts with a fixed base URL), attribution.ts (OpenRouter app headers, OPENROUTER_BASE_URL)
  prompts/       shared rules (shared.ts) + per-mode task text (index.ts)
  modes.ts       registry: id, buildPrompt, defaultModel, temperature
  sanitize.ts    strips quotes/preambles/fences, preserves surrounding whitespace
  run.ts         runMode(modeId, text, opts); throws InputError, passes ProviderError through; exports DEFAULT_MAX_CHARS
src/raycast/     Raycast glue: selection/clipboard/paste, preferences, error messages, tones
  preferences.ts thin wrappers over getPreferenceValues
  resolve.ts     pure preference resolution: model fallbacks (ANTHROPIC_DEFAULT_MODEL, GEMINI_* constants, compatibleDefaultModel), validateConfig, level -> mode
  selection-core.ts  paste/clipboard flow behind injectable dependencies (no @raycast import); selection.ts is the thin wiring
src/*.tsx        one file per command (fix-improve, shorten, change-tone, translate), thin wrappers
eval/            samples.jsonl, bench.ts, lib.ts (pure scoring, arg/sample parsing), prices.json (prices from provider pages and OpenRouter, dated 2026-10-05; re-check before relying on cost numbers)
```

## Rules

- **Keep `src/core` platform-agnostic.** Never import `@raycast/*` there. Provider code uses `fetch` only.
- **Keep testable logic out of files that import `@raycast/api`.** Vitest cannot resolve `@raycast/api` here, so `vi.mock` of it fails. Put pure logic in `resolve.ts`, `errors.ts`, `tones.ts` style modules and import only those in tests.
- **Never paste on failure.** Any error path must leave the user's text untouched and show a clear HUD/toast. If a paste was attempted, restore the clipboard in `finally` (before that point the clipboard is never touched).
- **Prompts treat user text as data.** Input is wrapped in a per-call nonce tag (`<input_text_<nonce>>`, chosen so the text cannot contain it) and the system prompt says to ignore instructions inside it and that only the exact closing tag ends the input. Keep that when editing prompts. Shared rules: return only the rewritten text, keep the input language (except Translate), keep markdown, code, URLs, @mentions, emoji and placeholders, no commentary.
- **Sanitizer:** `sanitize(output, original, { mode })` strips preambles, fences and wrapping quotes the input did not have. Always pass the mode from `runMode`; Translate must not strip a header the translation legitimately starts with. Eval's `hasPreamble` (`eval/lib.ts`) is a separate regex; `eval/lib.test.ts` has a shared fixture list that keeps the two in agreement, so extend both when you change the vocabulary.
- **Default models:** there is no single source. When changing a default, update every place it appears: `src/core/modes.ts` (`OPENAI_DEFAULT_MODEL`, used by every mode), `src/raycast/resolve.ts` (`ANTHROPIC_DEFAULT_MODEL`, and `GEMINI_OPENROUTER_MODEL` / `GEMINI_NATIVE_MODEL`, the recommended model used by the `openrouter` provider and by `openai-compatible` on OpenRouter or Google's endpoint), the `provider` and `defaultModel` descriptions and placeholder in `package.json`, the Setup section of `README.md`, `eval/prices.json` (price entry), and the tests in `src/raycast/resolve.test.ts`. Grep for the old model id to confirm nothing is left.
- **Prompt or sanitizer change:** add or adjust a table-driven test in `src/core/*.test.ts` and, for behaviour changes, a sample in `eval/samples.jsonl`. `must`/`mustNot` strings are judgment calls, so re-check failures after a real bench run before trusting them.
- **Preferences:** declared in `package.json`. `raycast-env.d.ts` is generated by `ray build` and gitignored. Do not hand-edit it; rebuild to regenerate.
- **Secrets:** API keys come only from the `apiKey` password preference. Never hardcode, log or commit keys. Bench reads keys from env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` for `openrouter:` specs and OpenRouter base URLs, `OPENAI_COMPATIBLE_API_KEY` for any other base URL).
- **Privacy:** text goes only to the user-configured provider. Never log or store user text or results (errors may be logged with `console.error`, which can include provider response text), no analytics, no caching. The only local storage is the last-used tone id (`LocalStorage` key `lastTone`). The README privacy section must stay true.
- **Security:** the full list is in `SECURITY.md`. When changing the request or paste path keep these true, each has tests: Base URL accepted only as https (or loopback/`*.local` http, no credentials; `baseUrlProblem` in `src/core/providers/base-url.ts`, checked by `createProvider` and `validateConfig`); `fetch` uses `redirect: "error"`; responses are size-capped (`MAX_RESPONSE_BYTES`); the OpenAI-style request sends a generous `max_tokens`/`max_completion_tokens` and `runMode` rejects absurdly long answers (`MAX_OUTPUT_RATIO`); `sanitize` strips control/bidi/zero-width/tag characters unless the original had them and must stay linear-time on long whitespace; the paste is skipped when the frontmost app changed; provider text shown in a HUD is cleaned and clipped.
- **Limits:** the 4,000-char input cap has a single source, `DEFAULT_MAX_CHARS` in `src/core/run.ts` (the Raycast layer must reference it, not repeat the number in code; prose docs may state it). The request timeout is 10 s (`REQUEST_TIMEOUT_MS` in `src/core/providers/http.ts`).

## Code style

- TypeScript strict, Prettier (`.prettierrc`), ESLint via `@raycast/eslint-config`. Run `npm run fix-lint` rather than formatting by hand.
- Match surrounding code: small modules, named exports, minimal comments that explain why.
- Avoid new dependencies. If one is needed, justify it and keep `package-lock.json` committed. No external analytics, no Keychain access, no bundled binaries (Raycast Store rules).

## Raycast Store guidelines (for the open-source release)

- Everything user-facing is **US English** and **Title Case** for the extension title and command titles. Command titles are `<verb> <noun>` or `<noun>`, no articles. Subtitles add context (service name) and must not repeat the title.
- `package.json`: `license: MIT`, `author` = real Raycast username (`sebastian_andrei_roman`; `ray lint` checks it against raycast.com), valid categories (`Productivity`), latest `@raycast/api`, `platforms` matches reality (macOS only for now).
- Icon: 512×512 PNG, works in light and dark, not the default Raycast icon (icon.ray.so). `assets/extension-icon.png` was rendered at 512×512 from an SVG that is no longer in the tree (`git show 2b4f504:docs/icon-source.svg`).
- Screenshots: 3 to 6, 2000×1250 PNG (16:10), made with Raycast's Window Capture, consistent background, no sensitive data. They go in `metadata/`.
- `CHANGELOG.md`: `## [Title] - {PR_MERGE_DATE}` headings. Add an entry for every user-visible change.
- Check the terms of service of the AI providers the extension calls.
- Publish with `npm run publish`; it opens a PR to `raycastapp/extensions`, where automated checks and human review run. Run `npm run build` and `npm run lint` first.

## Commits and PRs

- Short imperative subject (about 50 chars). Add a body only when the why is not obvious.
- Do not commit `node_modules`, `dist`, `raycast-env.d.ts`, `.remember/` or `eval/results/*` (except `.gitkeep`).
- Manual tasks (installing Raycast, API keys, hotkey binding, app compatibility pass, dogfooding, publishing) are the maintainer's; do not mark them done in the plan.

## Known gaps

- The clipboard/paste flow and Change Tone list are covered only by unit tests of pure logic; verify manually in TextEdit via `npm run dev`.
- `eval/prices.json` prices come from provider pricing pages and OpenRouter (2026-10-05); they drift, so re-check before trusting cost numbers.
- All modes share one model per provider. Default `google/gemini-3.1-flash-lite` was picked from a 2026-10-05 bench on OpenRouter (51 samples, 2 runs): 94% pass, p95 0.9 s, about $0.47 per 3,000 calls; it kept every sentence on the prompt-injection sample. `gemini-2.5-flash-lite` scored 96% but dropped text and has limited access, `mistral-small-2603` (86%) followed an injected instruction, `gpt-4.1-nano` (84%) was too slow (p95 4.5 s). Full write-up: `git log -p -- docs/models.md`. Re-run `npm run bench` when a model or price changes. Per-mode defaults are not implemented; they would need a change to `makeMode` in `modes.ts`, which gives every mode the same OpenAI default, and the provider-aware fallback in `resolve.ts` already exists.
