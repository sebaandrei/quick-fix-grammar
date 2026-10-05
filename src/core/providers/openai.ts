import { attributionHeaders } from "./attribution";
import { joinUrl, postJson } from "./http";
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

interface OpenAIResponse {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
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

      const choice = Array.isArray(json?.choices) ? json.choices[0] : undefined;
      const finish = choice?.finish_reason;
      if (finish === "length") {
        throw new ProviderError("bad_response", "The response was cut off because the model hit its token limit.");
      }
      if (finish === "content_filter") {
        throw new ProviderError("bad_response", "The response was blocked by the provider's content filter.");
      }
      const content = choice?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new ProviderError("bad_response", "Response did not contain message content.");
      }
      return content;
    },
  };
}
