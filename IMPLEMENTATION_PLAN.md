# Quick Fix Grammar — Implementation Plan (v1, macOS)

**Goal:** Select text in any app → press a hotkey → the text is fixed/rewritten in place by a cheap AI model, using the user's own API key.
**Vehicle:** Raycast extension (TypeScript/React). macOS only for v1; core logic kept platform-agnostic for later Windows / Tauri.
**License:** MIT, open source after personal validation.

## Commands (v1)

| Command | Type | Behaviour | Suggested hotkey |
|---|---|---|---|
| **Fix & Improve** | no-view | Fixes spelling/grammar and lightly polishes. A `level` setting picks between `Fix only` (minimal edits) and `Fix + Improve` (default). | `⇧ ⇧` (double Right Shift) |
| **Shorten** | no-view | Makes the text more concise and keeps the meaning | `⌥ ⌥` |
| **Change Tone** | list view | A list (Professional, Friendly, Casual, Confident, Direct) → pick one → paste | `⌃ ⌥ T` |
| **Translate** | no-view | Auto EN↔RO by default; the target language is configurable | `⌃ ⌥ L` |

## Architecture

```
src/
  core/                 # pure TS, no Raycast imports → reusable in Tauri/Windows later
    providers/
      types.ts          # LLMProvider interface: complete({system, user, model, signal})
      openai.ts         # OpenAI + any OpenAI-compatible base URL (OpenRouter, Groq, Ollama)
      anthropic.ts      # Anthropic Messages API
    prompts/            # one prompt per mode + shared rules
    modes.ts            # mode registry: id, prompt builder, default model, temperature
    sanitize.ts         # strip quotes/preambles/code fences, preserve trailing newline
    run.ts              # runMode(mode, text, opts) → string
  raycast/
    selection.ts        # getSelectedText + clipboard snapshot/restore + paste
    preferences.ts
  fix-improve.tsx
  shorten.tsx
  change-tone.tsx
  translate.tsx
eval/
  samples.jsonl         # golden EN + RO samples
  bench.ts              # model × mode → latency, cost, diff quality
```

**Shared prompt rules:** return only the rewritten text. Keep the input language (never translate except in Translate). Keep markdown, line breaks, code, URLs, @mentions, emojis and placeholders. Never add commentary. Temperature 0–0.3.

## About your OpenAI / Claude subscriptions

ChatGPT Plus and Claude Pro **do not include API access**. API usage is billed separately (pay-as-you-go) on platform.openai.com and console.anthropic.com. Third-party apps are not meant to reuse subscription logins.
- **v1:** API keys. For this workload (a few hundred tokens per fix) small models cost cents per month for personal use.
- **Backlog (experimental):** a "local CLI" provider that runs `claude -p` / `codex exec`, which already sign in with your subscription. It costs nothing extra but is likely 3–10 s per call, so it doesn't fit "instant".

---

## Tasks

Legend: ☐ todo · est = rough hours · **AC** = acceptance criteria

### Phase 0 — Setup
- ☐ **T01** Install Raycast + Node 22 LTS and enable Developer Mode. *(0.5h)* **AC:** `npx ray --version` works.
- ☐ **T02** Scaffold the extension with Raycast's "Create Extension" template in `fixgrammar/`. Set up git, MIT LICENSE, README stub, ESLint/Prettier. *(1h)* **AC:** `npm run dev` loads the extension in Raycast.
- ☐ **T03** Create API keys (OpenAI and/or Anthropic) with a monthly spend limit set. *(0.5h)*

### Phase 1 — Core (platform-agnostic)
- ☐ **T04** `LLMProvider` interface + OpenAI/OpenAI-compatible provider (`fetch`, AbortController, 10s timeout). *(2h)* **AC:** unit test hits a mocked endpoint and returns the text.
- ☐ **T05** Anthropic provider. *(1.5h)* **AC:** same contract and tests as T04.
- ☐ **T06** Prompt templates + mode registry (fix-only, fix-improve, shorten, tone×5, translate). *(2h)*
- ☐ **T07** Output sanitizer (strip quotes, "Here is…", code fences; preserve the original's leading/trailing whitespace). *(1h)* **AC:** table-driven tests pass.
- ☐ **T08** Vitest setup + core unit tests in CI (GitHub Actions). *(1.5h)*

### Phase 2 — Fix & Improve (MVP)
- ☐ **T09** `selection.ts`: snapshot clipboard → `getSelectedText()` → `Clipboard.paste(result)` → restore the previous clipboard. *(2h)* **AC:** the clipboard holds its original content after a fix.
- ☐ **T10** Preferences: provider, API key (password), base URL, default model, per-command model override, `level` (Fix only / Fix + Improve), English variant (US/UK). *(1.5h)*
- ☐ **T11** `fix-improve.tsx` no-view command: close window → show "Fixing…" toast → run → paste → `showHUD("Fixed ✓")`. *(2h)* **AC:** works end-to-end in TextEdit.
- ☐ **T12** Error handling: no selection, empty/too-long text (cap ~4k chars), 401/429/timeout. Each gets a clear HUD/toast, and nothing is pasted on failure. *(1.5h)*
- ☐ **T13** Assign the `⇧ ⇧` hotkey and confirm it triggers the extension command. Turn off Raycast's built-in Quick Fix hotkey if it clashes. *(0.5h)* **AC:** double Right Shift fixes text in place.
- ☐ **T14** App compatibility pass: Slack, Chrome (Gmail/Docs), Notion, Obsidian, VS Code, Mail, Teams, Terminal. Log results in `docs/compat.md`. *(2h)*

### Phase 3 — Model selection
- ☐ **T15** Eval set: ~30 samples (EN typos, RO with diacritics, markdown, code mixed in, long paragraph, already-correct text). *(2h)*
- ☐ **T16** `eval/bench.ts`: run each candidate model (e.g. gpt-5-mini/nano, Claude Haiku, Gemini Flash-Lite via OpenRouter). Record p50/p95 latency, cost per call and outputs for review. *(3h)*
- ☐ **T17** Pick the default model per mode and record the decision in `docs/models.md`. *(1h)* **AC:** p95 < 2s for Fix on a ~100-word input.

### Phase 4 — Shorten
- ☐ **T18** `shorten.tsx` no-view command reusing the T09/T11 flow, plus a prompt tuned on the eval set. *(1.5h)*

### Phase 5 — Change Tone
- ☐ **T19** `change-tone.tsx` list view: capture the selection **before** the list renders, then pick a tone → close → paste. *(2.5h)* **AC:** the pasted text replaces the original selection in the source app.
- ☐ **T20** Remember the last tone used and show it first. *(0.5h)*

### Phase 6 — Translate
- ☐ **T21** `translate.tsx`: auto-detect EN↔RO, with a setting for the target language (default "auto toggle EN/RO"). *(2h)*
- ☐ **T22** Add RO samples to the eval set and check diacritics (ș, ț, ă, â, î) survive. *(1h)*

### Phase 7 — Hardening & dogfooding
- ☐ **T23** Dogfood for 2 weeks and keep a log of failures and annoyances in `docs/dogfood.md`. *(ongoing)*
- ☐ **T24** Fix the top issues from T23 (prompt tweaks, edge cases). *(4h)*
- ☐ **T25** Privacy note in the README: text goes only to the configured provider, and nothing is stored or logged. *(0.5h)*

### Phase 8 — Open-source release
- ☐ **T26** Icon, command descriptions, screenshots, CHANGELOG. `npm run lint` passes against Raycast Store guidelines. *(3h)*
- ☐ **T27** Public GitHub repo plus a submission to the Raycast Store (`npm run publish`). *(1h)*

**Total ≈ 45h.** The MVP (T01–T13) is about 18h, so you can use it daily after roughly 2–3 evenings.

---

## Backlog (post-v1)
- Windows support: verify `getSelectedText`/paste on Raycast for Windows.
- Experimental "local CLI" provider (`claude -p` / `codex exec`) that uses your existing subscriptions.
- Ollama / local model for offline and private use.
- Custom user-defined modes (your own prompt + hotkey).
- Preview mode: a diff view with Accept/Reject, as an alternative command.
- History of recent fixes (local only) + "Paste original" undo.
- Standalone Tauri app reusing `src/core`.

## Decisions log
- 2026-10-02: Raycast extension over a native app (speed to validate; open-source fit; Raycast's own Quick Fix and bring-your-own-key are paid-only).
- 2026-10-02: macOS only for v1. Fix + Improve is one command; Shorten, Tone and Translate are separate.
- 2026-10-02: Bring-your-own API key (OpenAI/Anthropic/OpenAI-compatible). Subscriptions can't be used through the API.
