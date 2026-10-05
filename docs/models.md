# Model selection (T17)

Status: TEMPLATE. Fill in after running the benchmark with real API keys.

## How to run

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export OPENROUTER_API_KEY=...
npx tsx eval/bench.ts \
  --models "openai:gpt-5-mini,openai:gpt-5-nano,anthropic:claude-haiku-4-5-20251001,openai-compatible@https://openrouter.ai/api/v1:google/gemini-2.5-flash-lite" \
  --runs 5
```

Results land in `eval/results/<timestamp>.json` and `.md` (summary table plus every output for manual review).
Edit `eval/prices.json` first: the prices in it are placeholders. Without provider usage data, cost is estimated as
characters / 4 tokens.

Bench date: `YYYY-MM-DD`. Results file: `eval/results/<timestamp>.json`. Runs per sample: `N`.

## Acceptance criterion

Fix mode, ~100-word input (sample `long-fix-en`): **p95 latency < 2 s** for the chosen default model.

## Results

| Model                                    | Pass rate | p50 | p95 | p95 Fix 100w (AC < 2 s) | Cost/call | Diacritics (RO) | Injection | Notes |
| ---------------------------------------- | --------- | --- | --- | ----------------------- | --------- | --------------- | --------- | ----- |
| openai:gpt-5-mini                        |           |     |     |                         |           |                 |           |       |
| openai:gpt-5-nano                        |           |     |     |                         |           |                 |           |       |
| anthropic:claude-haiku-4-5-20251001      |           |     |     |                         |           |                 |           |       |
| openrouter: google/gemini-2.5-flash-lite |           |     |     |                         |           |                 |           |       |

Manual review notes (read the outputs, automatic checks do not judge quality): tone naturalness, Romanian grammar,
over-editing of already-correct text, faithfulness of translations.

## Decision

| Mode        | Default model | Why | p95 | Cost/call |
| ----------- | ------------- | --- | --- | --------- |
| fix-only    |               |     |     |           |
| fix-improve |               |     |     |           |
| shorten     |               |     |     |           |
| tone-*      |               |     |     |           |
| translate   |               |     |     |           |

Apply by setting `defaultModel` per mode in `src/core/modes.ts` and the `defaultModel` preference placeholder.

## Rejected models

- `model`: reason (latency, diacritics, over-editing, ...)

## Re-evaluate when

- A provider ships a new small model, or prices change.
- Dogfooding (`docs/dogfood.md`) shows repeated failures on a mode.
