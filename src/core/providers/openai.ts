import { attributionHeaders } from "./attribution";
import { errorForStatus, joinUrl, postJson } from "./http";
import { ProviderError, type CompleteRequest, type LLMProvider } from "./types";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIProviderConfig {
  apiKey: string;
  /** Defaults to https://api.openai.com/v1. Any OpenAI-compatible base URL works. */
  baseUrl?: string;
}

/** gpt-5 / o-series models only accept the default temperature. */
export function isFixedTemperatureModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

/** Only these accept reasoning_effort "minimal"; other gpt-5 variants (e.g. gpt-5.1, gpt-5-codex) may reject it. */
export function supportsMinimalReasoning(model: string): boolean {
  return /^gpt-5(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/i.test(model.trim());
}

export function isOfficialBaseUrl(baseUrl: string): boolean {
  return baseUrl.trim().replace(/\/+$/, "").toLowerCase() === OPENAI_BASE_URL;
}

/**
 * Upper bound on generated tokens (cost and runaway-output guard). Generous on purpose: reasoning models spend
 * hidden thinking tokens inside this budget, so a tight cap would cut off legitimate answers.
 */
export function estimateMaxTokens(userChars: number): number {
  return Math.min(16_384, Math.max(4_096, Math.ceil(userChars * 1.5) + 1_024));
}

interface OpenAIResponse {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  /** OpenRouter can answer HTTP 200 with a top-level error object and no choices. */
  error?: { message?: unknown; code?: unknown };
}

function errorFromBody(error: NonNullable<OpenAIResponse["error"]>): ProviderError {
  const message = typeof error.message === "string" ? error.message : "The provider reported an error.";
  const code = typeof error.code === "number" ? error.code : Number(error.code);
  // A numeric code is an HTTP-style status (402, 429, ...): reuse the status mapping.
  return Number.isInteger(code) && code >= 400 && code < 600
    ? errorForStatus(code, message)
    : new ProviderError("bad_response", `The provider reported an error: ${message.slice(0, 300)}`);
}

function finishReasonError(finish: unknown): ProviderError | undefined {
  switch (finish) {
    // Only these mean the model finished its answer; a missing reason is tolerated because some hosts omit it.
    case undefined:
    case null:
    case "stop":
    case "tool_calls":
      return undefined;
    case "length":
      return new ProviderError("bad_response", "The response was cut off because the model hit its token limit.");
    case "content_filter":
      return new ProviderError("bad_response", "The response was blocked by the provider's content filter.");
    case "error":
      return new ProviderError("bad_response", "The provider failed mid-response, so the text may be incomplete.");
    default:
      return new ProviderError("bad_response", `The response ended unexpectedly (finish reason: ${String(finish)}).`);
  }
}

export function createOpenAIProvider(cfg: OpenAIProviderConfig): LLMProvider {
  const baseUrl = cfg.baseUrl?.trim() || OPENAI_BASE_URL;
  const isOfficial = isOfficialBaseUrl(baseUrl);

  return {
    async complete(req: CompleteRequest): Promise<string> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      };
      // OpenAI's own gpt-5 / o-series models reject max_tokens and take max_completion_tokens instead.
      const capParam = isOfficial && isFixedTemperatureModel(req.model) ? "max_completion_tokens" : "max_tokens";
      body[capParam] = estimateMaxTokens(req.user.length);
      if (isOfficial && supportsMinimalReasoning(req.model)) body.reasoning_effort = "minimal";
      if (req.temperature !== undefined && !(isOfficial && isFixedTemperatureModel(req.model))) {
        body.temperature = req.temperature;
      }

      const json = (await postJson(
        joinUrl(baseUrl, "chat/completions"),
        { Authorization: `Bearer ${cfg.apiKey}`, ...attributionHeaders(baseUrl) },
        body,
        req.signal,
      )) as OpenAIResponse | null;

      if (json?.error) throw errorFromBody(json.error);
      const choice = Array.isArray(json?.choices) ? json.choices[0] : undefined;
      const finishError = finishReasonError(choice?.finish_reason);
      if (finishError) throw finishError;
      const content = choice?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new ProviderError("bad_response", "Response did not contain message content.");
      }
      return content;
    },
  };
}
