import type { BuiltPrompt, PromptOptions } from "../modes";
import { composeSystem, wrapInput } from "./shared";

export { SHARED_RULES } from "./shared";

export const FIX_ONLY_TASK =
  "Fix spelling, grammar, punctuation, and capitalization errors with the MINIMAL possible edits. Do not rephrase, reorder, change word choice, tone, or style, and do not improve clarity. Only change what is clearly wrong.";

export const FIX_IMPROVE_TASK =
  "Fix spelling, grammar, punctuation, and capitalization errors, and lightly polish the text for clarity and flow. Keep the author's voice, tone, meaning, and approximate length. Do not make it fancier or longer.";

export const SHORTEN_TASK =
  "Make the text more concise while keeping its full meaning, key details, and tone. Remove filler and redundancy. Fix obvious errors along the way. Never add content.";

export type Tone = "professional" | "friendly" | "casual" | "confident" | "direct";

export const TONE_TASKS: Record<Tone, string> = {
  professional:
    "Rewrite the text in a professional tone: polished, courteous, and clear, suitable for workplace communication. Keep the meaning and facts unchanged.",
  friendly:
    "Rewrite the text in a friendly tone: warm, approachable, and positive. Keep the meaning and facts unchanged.",
  casual:
    "Rewrite the text in a casual tone: relaxed and conversational, like talking to a colleague or friend. Keep the meaning and facts unchanged.",
  confident:
    "Rewrite the text in a confident tone: assured and decisive, removing hedging and apologetic phrasing. Keep the meaning and facts unchanged.",
  direct:
    "Rewrite the text in a direct tone: straightforward and to the point, with no fluff or softening. Keep the meaning and facts unchanged.",
};

export function translateTask(opts: PromptOptions): string {
  const target = opts.targetLanguage?.trim();
  if (target) {
    return `Translate the text into ${target}. Keep the meaning, tone, and formatting. If it is already in ${target}, return it unchanged.`;
  }
  return "Translate the text between English and Romanian. Detect the language of the input: if it is Romanian, translate it to English; if it is English, translate it to Romanian (with correct diacritics ă, â, î, ș, ț); if it is any other language, translate it to English. Keep the meaning, tone, and formatting. This task overrides the 'keep the input language' rule.";
}

export function buildPrompt(task: string, text: string, opts: PromptOptions): BuiltPrompt {
  return { system: composeSystem(task, opts), user: wrapInput(text) };
}
