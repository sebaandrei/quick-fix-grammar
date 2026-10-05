import { getPreferenceValues } from "@raycast/api";
import { clean, resolveModel } from "./resolve";

export { levelToMode, resolveModel } from "./resolve";

export type ProviderId = "openai" | "anthropic" | "openai-compatible";

export interface ExtensionConfig {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  level: "fix-only" | "fix-improve";
  englishVariant: "us" | "uk";
}

export function getExtensionConfig(): ExtensionConfig {
  const p = getPreferenceValues<ExtensionPreferences>();
  return {
    provider: p.provider,
    apiKey: p.apiKey,
    baseUrl: clean(p.baseUrl),
    defaultModel: clean(p.defaultModel),
    level: p.level ?? "fix-improve",
    englishVariant: p.englishVariant ?? "us",
  };
}

/** Model override pref of the current command (all commands share the `model` pref name). */
export function getModel(): string | undefined {
  const p = getPreferenceValues<ExtensionPreferences & { model?: string }>();
  return resolveModel(p.model, p.defaultModel, p.provider);
}

export function getTargetLanguage(): string | undefined {
  const p = getPreferenceValues<ExtensionPreferences & { targetLanguage?: string }>();
  return clean(p.targetLanguage);
}
