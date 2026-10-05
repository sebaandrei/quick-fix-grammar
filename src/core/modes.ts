import { buildPrompt, FIX_IMPROVE_TASK, FIX_ONLY_TASK, SHORTEN_TASK, TONE_TASKS, translateTask } from "./prompts";

export type ModeId =
  | "fix-only"
  | "fix-improve"
  | "shorten"
  | "tone-professional"
  | "tone-friendly"
  | "tone-casual"
  | "tone-confident"
  | "tone-direct"
  | "translate";

export interface PromptOptions {
  /** English spelling convention for English output. */
  englishVariant?: "us" | "uk";
  /** Translate only: target language; undefined = auto toggle EN/RO. */
  targetLanguage?: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export interface Mode {
  id: ModeId;
  buildPrompt(text: string, opts: PromptOptions): BuiltPrompt;
  defaultModel: string;
  temperature: number;
}

const OPENAI_DEFAULT_MODEL = "gpt-5-mini";

function mode(id: ModeId, task: string | ((opts: PromptOptions) => string), temperature: number): Mode {
  return {
    id,
    defaultModel: OPENAI_DEFAULT_MODEL,
    temperature,
    buildPrompt: (text, opts) => buildPrompt(typeof task === "function" ? task(opts) : task, text, opts),
  };
}

export const modes: Record<ModeId, Mode> = {
  "fix-only": mode("fix-only", FIX_ONLY_TASK, 0),
  "fix-improve": mode("fix-improve", FIX_IMPROVE_TASK, 0.2),
  shorten: mode("shorten", SHORTEN_TASK, 0.2),
  "tone-professional": mode("tone-professional", TONE_TASKS.professional, 0.3),
  "tone-friendly": mode("tone-friendly", TONE_TASKS.friendly, 0.3),
  "tone-casual": mode("tone-casual", TONE_TASKS.casual, 0.3),
  "tone-confident": mode("tone-confident", TONE_TASKS.confident, 0.3),
  "tone-direct": mode("tone-direct", TONE_TASKS.direct, 0.3),
  translate: mode("translate", translateTask, 0.1),
};
