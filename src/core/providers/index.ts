import { createAnthropicProvider } from "./anthropic";
import { createOpenAIProvider } from "./openai";
import type { LLMProvider } from "./types";

export type ProviderName = "openai" | "anthropic" | "openai-compatible";

export interface ProviderConfig {
  provider: ProviderName;
  apiKey: string;
  baseUrl?: string;
}

export function createProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "anthropic":
      return createAnthropicProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    case "openai":
    case "openai-compatible":
      return createOpenAIProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
  }
}

export * from "./types";
export { createOpenAIProvider } from "./openai";
export { createAnthropicProvider } from "./anthropic";
