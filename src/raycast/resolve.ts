import type { EnglishVariant, ModeId } from "../core/modes";
import type { ProviderId } from "../core/providers/types";
import { ConfigError } from "./errors";

export interface ExtensionConfig {
  provider: ProviderId;
  apiKey: string;
  /** Only set for the openai-compatible provider. */
  baseUrl?: string;
  defaultModel?: string;
  level: "fix-only" | "fix-improve";
  englishVariant: EnglishVariant;
}

export interface RawPreferences {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  level?: string;
  englishVariant?: string;
}

/** Core mode defaults are OpenAI models, so Anthropic needs its own fallback. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const clean = (v?: string | null): string | undefined => v?.trim() || undefined;

export function buildConfig(p: RawPreferences): ExtensionConfig {
  return {
    provider: p.provider,
    apiKey: (p.apiKey ?? "").trim(),
    baseUrl: p.provider === "openai-compatible" ? clean(p.baseUrl) : undefined,
    defaultModel: clean(p.defaultModel),
    level: p.level === "fix-only" ? "fix-only" : "fix-improve",
    englishVariant: p.englishVariant === "uk" ? "uk" : "us",
  };
}

/** command override || default model || Anthropic fallback; undefined lets runMode use the mode default. */
export function modelFor(p: { provider?: string; model?: string; defaultModel?: string }): string | undefined {
  return clean(p.model) || clean(p.defaultModel) || (p.provider === "anthropic" ? ANTHROPIC_DEFAULT_MODEL : undefined);
}

export function targetLanguageFor(p: { targetLanguage?: string }): string | undefined {
  return clean(p.targetLanguage);
}

/** Throws ConfigError when the preferences cannot produce a working request. `model` is the resolved model. */
export function validateConfig(cfg: ExtensionConfig, model?: string): void {
  if (!cfg.apiKey.trim()) throw new ConfigError("missing_api_key");
  if (cfg.provider === "openai-compatible") {
    if (!cfg.baseUrl) throw new ConfigError("missing_base_url");
    if (!clean(model)) throw new ConfigError("missing_model");
  }
}

export function levelToMode(level?: string): ModeId {
  return level === "fix-only" ? "fix-only" : "fix-improve";
}
