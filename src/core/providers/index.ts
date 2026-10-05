import { createAnthropicProvider } from "./anthropic";
import { OPENROUTER_BASE_URL } from "./attribution";
import { createOpenAIProvider } from "./openai";
import { ProviderError, type LLMProvider, type ProviderId } from "./types";

export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
}

/**
 * `baseUrl` is honored only by `openai-compatible`. Every other provider has a fixed endpoint, so a stale
 * or foreign URL (left over from another provider setting) can never receive the key and the text.
 */
export function createProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "openrouter":
      return createOpenAIProvider({ apiKey: cfg.apiKey, baseUrl: OPENROUTER_BASE_URL });
    case "anthropic":
      return createAnthropicProvider({ apiKey: cfg.apiKey });
    case "openai":
      return createOpenAIProvider({ apiKey: cfg.apiKey });
    case "openai-compatible":
      if (!cfg.baseUrl?.trim()) {
        throw new ProviderError("request", "Base URL is required for OpenAI-compatible providers");
      }
      return createOpenAIProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    default: {
      const unknown: never = cfg.provider;
      throw new Error(`Unknown provider: ${String(unknown)}`);
    }
  }
}

export * from "./types";
export { createOpenAIProvider } from "./openai";
export { createAnthropicProvider } from "./anthropic";
