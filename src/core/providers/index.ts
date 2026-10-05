import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import { ProviderError, type LLMProvider, type ProviderId } from "./types";

/** @deprecated Use ProviderId. */
export type ProviderName = ProviderId;

export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
}

export function createProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "anthropic":
      return createAnthropicProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    case "openai-compatible":
      if (!cfg.baseUrl?.trim()) {
        throw new ProviderError("request", "Base URL is required for OpenAI-compatible providers");
      }
      return createOpenAIProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    case "openai":
      return createOpenAIProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
  }
}

export * from "./types";
export { createOpenAIProvider } from "./openai";
export { createAnthropicProvider } from "./anthropic";
