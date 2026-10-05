import { modes, type ModeId } from "./modes";
import { sanitize } from "./sanitize";
import type { LLMProvider } from "./providers/types";

export interface RunOptions {
  provider: LLMProvider;
  model?: string;
  englishVariant?: "us" | "uk";
  targetLanguage?: string;
  signal?: AbortSignal;
  /** Default 4000. */
  maxChars?: number;
}

export type InputErrorKind = "empty" | "too_long";

export class InputError extends Error {
  readonly kind: InputErrorKind;

  constructor(kind: InputErrorKind, message: string) {
    super(message);
    this.name = "InputError";
    this.kind = kind;
  }
}

export const DEFAULT_MAX_CHARS = 4000;

export async function runMode(modeId: ModeId, text: string, opts: RunOptions): Promise<string> {
  const mode = modes[modeId];
  if (!mode) throw new Error(`Unknown mode: ${modeId}`);

  if (text.trim().length === 0) throw new InputError("empty", "There is no text to process.");
  const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
  if (text.length > max) {
    throw new InputError("too_long", `Text is too long (${text.length} characters; limit is ${max}).`);
  }

  const { system, user } = mode.buildPrompt(text, {
    englishVariant: opts.englishVariant,
    targetLanguage: opts.targetLanguage,
  });
  const raw = await opts.provider.complete({
    system,
    user,
    model: opts.model?.trim() || mode.defaultModel,
    temperature: mode.temperature,
    signal: opts.signal,
  });
  return sanitize(raw, text);
}
