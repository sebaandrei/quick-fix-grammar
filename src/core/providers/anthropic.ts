import { joinUrl, postJson } from "./http";
import { ProviderError, type CompleteRequest, type LLMProvider } from "./types";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Output is roughly the size of the input, but translation can expand it and non-Latin
 * text tokenizes poorly: budget 1.5 tokens per input char plus fixed headroom.
 * Floor 512, cap 8192.
 */
export function estimateMaxTokens(inputChars: number): number {
  const tokens = Math.ceil(Math.max(0, inputChars) * 1.5) + 256;
  return Math.min(8192, Math.max(512, tokens));
}

export function createAnthropicProvider(cfg: AnthropicProviderConfig): LLMProvider {
  const baseUrl = cfg.baseUrl?.trim() || ANTHROPIC_BASE_URL;

  return {
    async complete(req: CompleteRequest): Promise<string> {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: estimateMaxTokens(req.user.length),
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;

      const json = (await postJson(
        joinUrl(baseUrl, "messages"),
        { "x-api-key": cfg.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        body,
        req.signal,
      )) as {
        content?: { type?: string; text?: unknown }[];
        stop_reason?: unknown;
      } | null;

      if (json?.stop_reason === "max_tokens") {
        throw new ProviderError("bad_response", "The response was cut off because the model hit its token limit.");
      }
      if (json?.stop_reason === "refusal") {
        throw new ProviderError("bad_response", "The model refused to process this text.");
      }

      const blocks = Array.isArray(json?.content) ? json.content : [];
      const text = blocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      if (text.trim().length === 0) {
        throw new ProviderError("bad_response", "Response did not contain text content.");
      }
      return text;
    },
  };
}
