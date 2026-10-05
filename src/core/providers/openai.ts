import { joinUrl, postJson } from "./http";
import { ProviderError, type CompleteRequest, type LLMProvider } from "./types";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIProviderConfig {
  apiKey: string;
  /** Defaults to https://api.openai.com/v1. Any OpenAI-compatible base URL works. */
  baseUrl?: string;
}

/** gpt-5 / o-series models only accept the default temperature. */
function isFixedTemperatureModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

export function createOpenAIProvider(cfg: OpenAIProviderConfig): LLMProvider {
  const baseUrl = cfg.baseUrl?.trim() || OPENAI_BASE_URL;
  const isOfficial = baseUrl.replace(/\/+$/, "") === OPENAI_BASE_URL;

  return {
    async complete(req: CompleteRequest): Promise<string> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      };
      const reasoning = isOfficial && /^gpt-5/i.test(req.model);
      if (reasoning) body.reasoning_effort = "minimal";
      if (req.temperature !== undefined && !(isOfficial && isFixedTemperatureModel(req.model))) {
        body.temperature = req.temperature;
      }

      const json = (await postJson(
        joinUrl(baseUrl, "chat/completions"),
        { Authorization: `Bearer ${cfg.apiKey}` },
        body,
        req.signal,
      )) as { choices?: { message?: { content?: unknown } }[] };

      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new ProviderError("bad_response", "Response did not contain message content.");
      }
      return content;
    },
  };
}
