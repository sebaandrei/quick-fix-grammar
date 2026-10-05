import type { ModeId } from "../core/modes";

export const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

/** command override || defaultModel || undefined (runMode falls back to the mode default). */
export function resolveModel(commandModel?: string, defaultModel?: string, provider?: string): string | undefined {
  return clean(commandModel) ?? clean(defaultModel) ?? (provider === "anthropic" ? ANTHROPIC_DEFAULT_MODEL : undefined);
}

/** Core mode defaults are OpenAI models, so Anthropic needs its own fallback. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function levelToMode(level?: string): ModeId {
  return level === "fix-only" ? "fix-only" : "fix-improve";
}
