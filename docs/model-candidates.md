# Model candidates (investigation, 2026-10-05)

Goal: smaller, cheaper models than the current defaults (`gpt-5-mini`, `claude-haiku-4-5-20251001`) for Fix, Shorten, Tone and Translate. Prices are USD per 1M tokens (input / output) from provider pricing pages and OpenRouter's public model list. OpenRouter figures are the cheapest listed provider and differ by provider, so re-check before relying on them. This document is the pre-benchmark shortlist. **The decision is in `docs/models.md`: Gemini 3.1 Flash-Lite (`google/gemini-3.1-flash-lite`).** The price and capability notes below are dated 2026-10-05 and were not updated after the bench.

## Cost does not decide this

A typical call is about 500 input tokens (system prompt plus ~100 words) and 150 output tokens. At 100 calls a day (3,000 a month):

| Model                               | $ per 1k calls | $ per month |
| ----------------------------------- | -------------- | ----------- |
| gpt-oss-20b                         | 0.02           | 0.06        |
| qwen3.7-flash                       | 0.03           | 0.10        |
| gpt-5-nano                          | 0.09           | 0.26        |
| gemini-2.5-flash-lite               | 0.11           | 0.33        |
| deepseek-v4-flash (cheap providers) | 0.07           | 0.21        |
| gpt-5-mini                          | 0.43           | 1.28        |
| kimi-k2-0905                        | 0.68           | 2.03        |
| claude-haiku-4.5                    | 1.25           | 3.75        |

Even the dearest option costs a few dollars a month, so latency (p95 < 2 s for a ~100-word Fix) and quality (Romanian diacritics, leaving correct text alone, ignoring injected instructions) should pick the default. Cheap is a tiebreaker.

## Shortlist to bench

| Model id (as passed to the bench)         | In / out                 | Why it is on the list                                                                                                             |
| ----------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `gpt-5-nano` (openai)                     | 0.05 / 0.40              | OpenAI's floor. Reasoning model; core sends `reasoning_effort: minimal` for it.                                                   |
| `gpt-4.1-nano` (openai)                   | 0.10 / 0.40              | Non-reasoning, so no hidden thinking tokens. Likely fast.                                                                         |
| `google/gemini-2.5-flash-lite`            | 0.10 / 0.40              | Already in the plan. Locked price, no announced rise.                                                                             |
| `google/gemini-3.1-flash-lite`            | 0.25 / 1.50              | Newer Flash-Lite. Gemini 3.x prices rise on 2027-01-01.                                                                           |
| `qwen/qwen3.7-flash`                      | 0.03 / 0.13              | Cheapest credible small model. Check Romanian.                                                                                    |
| `deepseek/deepseek-v4-flash`              | 0.09 / 0.18              | Requested. Output price ranges 0.08 to 1.66 by provider, so pin a cheap provider. Reasoning-capable.                              |
| `deepseek/deepseek-v3.2`                  | 0.26 / 0.38              | Older non-thinking DeepSeek; safer for latency.                                                                                   |
| `openai/gpt-oss-120b`                     | 0.04 / 0.17              | Open weights, very cheap. Groq and Cerebras host it, so it may be the fastest.                                                    |
| `openai/gpt-oss-20b`                      | 0.02 / 0.09              | Smallest option; may be weak on Romanian.                                                                                         |
| `mistralai/mistral-small-2603`            | 0.15 / 0.60              | European company; likely good Romanian.                                                                                           |
| `mistralai/ministral-14b-2512`            | 0.20 / 0.20              | Non-reasoning, flat price.                                                                                                        |
| `z-ai/glm-5.3-flash`                      | 0.15 / 0.50              | Requested class (Chinese labs). Reasoning-capable.                                                                                |
| `minimax/minimax-m2.7`                    | 0.21 / 0.84              | Same.                                                                                                                             |
| `moonshotai/kimi-k2-0905`                 | 0.60 / 2.50              | Requested. Not cheap, and published speed is only 30 to 50 tokens/s, so unlikely to meet the latency AC. Include once to confirm. |
| `meta-llama/llama-3.3-70b-instruct`       | 0.10 / 0.32              | Mature non-reasoning baseline.                                                                                                    |
| `gpt-5-mini`, `claude-haiku-4-5-20251001` | 0.25 / 2.00, 1.00 / 5.00 | Current defaults, as the baseline to beat.                                                                                        |

Kimi K2.5 to K2.7 (0.45 to 0.95 in, 2.25 to 4.00 out) are reasoning or code variants and cost more; skipped.

## Things to watch

- **Reasoning models.** Several candidates think by default. Hidden reasoning tokens add latency and cost, and the output price above may understate real cost. The OpenAI-compatible provider sends no reasoning parameter, so a bench through OpenRouter measures each model's default. If a reasoning model looks slow, retest with reasoning off (OpenRouter takes `reasoning: { enabled: false }`). That needs a small optional extra-parameters setting in `src/core/providers/openai.ts`; not added yet.
- **Latency is unmeasured.** OpenRouter's per-endpoint latency and throughput fields came back empty, so only our own bench can say. The one data point found: Kimi K2 about 1.2 to 1.5 s time to first token at 30 to 53 tokens/s.
- **Provider choice matters.** The same model costs up to 20 times more on different hosts, and the cheapest hosts are often fp4 quantized. Quantization can hurt diacritics. Pin a provider for the final pick.
- **Privacy.** Text goes to whichever host serves the model. DeepSeek, Moonshot, Z.ai and MiniMax direct APIs are China-hosted, and some OpenRouter hosts keep prompts. The README says text goes only to the configured provider, which stays true, but state the host in the preference description if one of these becomes a recommended default.
- **Prices drift.** Aggregator sites disagreed (for example DeepSeek V4-Flash at $0.10 vs $0.14 input). Treat all figures here as dated 2026-10-05.

## Run the bench

OpenRouter alone reaches everything except the direct OpenAI and Anthropic baselines, so one key covers most of it:

```
export OPENROUTER_API_KEY=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=...
npm run bench -- --runs 5 --models "openai:gpt-5-nano,openai:gpt-4.1-nano,openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001,openai-compatible@https://openrouter.ai/api/v1:google/gemini-2.5-flash-lite,openai-compatible@https://openrouter.ai/api/v1:google/gemini-3.1-flash-lite,openai-compatible@https://openrouter.ai/api/v1:qwen/qwen3.7-flash,openai-compatible@https://openrouter.ai/api/v1:deepseek/deepseek-v4-flash,openai-compatible@https://openrouter.ai/api/v1:deepseek/deepseek-v3.2,openai-compatible@https://openrouter.ai/api/v1:openai/gpt-oss-120b,openai-compatible@https://openrouter.ai/api/v1:mistralai/mistral-small-2603,openai-compatible@https://openrouter.ai/api/v1:z-ai/glm-5.3-flash,openai-compatible@https://openrouter.ai/api/v1:moonshotai/kimi-k2-0905,openai-compatible@https://openrouter.ai/api/v1:meta-llama/llama-3.3-70b-instruct"
```

Run `npm run bench -- --dry-run` first to check the setup without spending anything. For a fast first pass use `--runs 2 --filter latency-ac` (the 100-word Fix sample) to drop slow models before the full run.

Then pick defaults per mode and record them in `docs/models.md`. If a default changes, follow the checklist in `AGENTS.md`.
