import { joinUrl, postJson } from "./http";
import { ProviderError, type CompleteRequest, type LLMProvider } from "./types";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/** Output is roughly the size of the input (translation may expand it); leave headroom. */
export function estimateMaxTokens(inputChars: number): number {
  const tokens = Math.ceil(inputChars / 2) + 256;
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
      )) as { content?: { type?: string; text?: unknown }[] };

      const blocks = Array.isArray(json?.content) ? json.content : [];
      const text = blocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      if (text.length === 0) {
        throw new ProviderError("bad_response", "Response did not contain text content.");
      }
      return text;
    },
  };
}
