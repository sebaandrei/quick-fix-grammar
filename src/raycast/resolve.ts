import type { EnglishVariant, ModeId } from "../core/modes";
import { isProviderId, type ProviderId } from "../core/providers/types";
import { isOpenRouterUrl } from "../core/providers/attribution";
import { ConfigError } from "./errors";

/** The two modes the Fix & Improve Level preference can select. */
export type FixLevel = Extract<ModeId, "fix-only" | "fix-improve">;

export interface ExtensionConfig {
  provider: ProviderId;
  apiKey: string;
  /** Only set for the openai-compatible provider. */
  baseUrl?: string;
  defaultModel?: string;
  level: FixLevel;
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

/** Core mode defaults are OpenAI models, so every non-OpenAI provider needs its own fallback. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const clean = (v?: string | null): string | undefined => v?.trim() || undefined;

export function buildConfig(p: RawPreferences): ExtensionConfig {
  return {
    provider: p.provider,
    apiKey: (p.apiKey ?? "").trim(),
    baseUrl: p.provider === "openai-compatible" ? clean(p.baseUrl) : undefined,
    defaultModel: clean(p.defaultModel),
    level: levelToMode(p.level),
    englishVariant: p.englishVariant === "uk" ? "uk" : "us",
  };
}

/** Recommended model (README, "Model choice"): Gemini 3.1 Flash-Lite, named differently by each host. */
export const GEMINI_OPENROUTER_MODEL = "google/gemini-3.1-flash-lite";
export const GEMINI_NATIVE_MODEL = "gemini-3.1-flash-lite";
const GOOGLE_OPENAI_HOST = "generativelanguage.googleapis.com";

/** Fallback for the openai-compatible provider when the base URL is a host with a known recommended model. */
export function compatibleDefaultModel(baseUrl?: string): string | undefined {
  const url = clean(baseUrl);
  if (!url) return undefined;
  if (isOpenRouterUrl(url)) return GEMINI_OPENROUTER_MODEL;
  try {
    if (new URL(url).hostname.toLowerCase() === GOOGLE_OPENAI_HOST) return GEMINI_NATIVE_MODEL;
  } catch {
    // not a URL: no fallback
  }
  return undefined;
}

/**
 * command override || default model || provider fallback (Anthropic: Haiku; OpenRouter, and openai-compatible
 * on OpenRouter or Google: Gemini 3.1 Flash-Lite). undefined means: openai uses the mode default (gpt-5-mini),
 * and openai-compatible on any other host must be given a model (validateConfig throws).
 */
export function modelFor(p: {
  provider?: ProviderId;
  model?: string;
  defaultModel?: string;
  baseUrl?: string;
}): string | undefined {
  const explicit = clean(p.model) || clean(p.defaultModel);
  if (explicit) return explicit;
  switch (p.provider) {
    case "anthropic":
      return ANTHROPIC_DEFAULT_MODEL;
    case "openrouter":
      return GEMINI_OPENROUTER_MODEL;
    case "openai-compatible":
      return compatibleDefaultModel(p.baseUrl);
    case "openai":
    case undefined:
      return undefined;
    default: {
      const unknown: never = p.provider;
      return unknown;
    }
  }
}

export function targetLanguageFor(p: { targetLanguage?: string }): string | undefined {
  return clean(p.targetLanguage);
}

/** Throws ConfigError when the preferences cannot produce a working request. `model` is the resolved model. */
export function validateConfig(cfg: ExtensionConfig, model?: string): void {
  if (!isProviderId(cfg.provider)) throw new ConfigError("unknown_provider");
  if (!cfg.apiKey.trim()) throw new ConfigError("missing_api_key");
  if (cfg.provider === "openai-compatible") {
    if (!cfg.baseUrl) throw new ConfigError("missing_base_url");
    if (!clean(model)) throw new ConfigError("missing_model");
  }
}

export function levelToMode(level?: string): FixLevel {
  return level === "fix-only" ? "fix-only" : "fix-improve";
}
