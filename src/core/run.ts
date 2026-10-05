import { isModeId, modes, type ModeId, type PromptOptions } from "./modes";
import { sanitize } from "./sanitize";
import { ProviderError, type LLMProvider } from "./providers/types";

export const DEFAULT_MAX_CHARS = 4000;

export interface RunOptions extends PromptOptions {
  provider: LLMProvider;
  model?: string;
  signal?: AbortSignal;
  /** Positive integer; anything else falls back to DEFAULT_MAX_CHARS. */
  maxChars?: number;
}

export type InputErrorKind = "empty" | "too_long";

export class InputError extends Error {
  override readonly name = "InputError";
  readonly kind: InputErrorKind;
  /** too_long only: the maximum allowed length. */
  readonly limit?: number;
  /** too_long only: the actual length. */
  readonly length?: number;

  constructor(kind: InputErrorKind, message: string, details?: { limit?: number; length?: number }) {
    super(message);
    this.kind = kind;
    this.limit = details?.limit;
    this.length = details?.length;
  }
}

export async function runMode(modeId: ModeId, text: string, opts: RunOptions): Promise<string> {
  if (!isModeId(modeId)) throw new Error(`Unknown mode: ${String(modeId)}`);
  const mode = modes[modeId];

  if (text.trim().length === 0) throw new InputError("empty", "There is no text to process.");
  const max =
    typeof opts.maxChars === "number" && Number.isInteger(opts.maxChars) && opts.maxChars > 0
      ? opts.maxChars
      : DEFAULT_MAX_CHARS;
  if (text.length > max) {
    throw new InputError("too_long", `Text is too long (${text.length} characters; limit is ${max}).`, {
      limit: max,
      length: text.length,
    });
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
  const result = sanitize(raw, text, { mode: modeId });
  if (result.trim() === "") throw new ProviderError("bad_response", "Model returned no usable text");
  return result;
}
