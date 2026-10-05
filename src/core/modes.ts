import { buildPrompt, FIX_IMPROVE_TASK, FIX_ONLY_TASK, SHORTEN_TASK, TONE_TASKS, translateTask } from "./prompts";
import type { NonceGenerator } from "./prompts";

export const MODE_IDS = [
  "fix-only",
  "fix-improve",
  "shorten",
  "tone-professional",
  "tone-friendly",
  "tone-casual",
  "tone-confident",
  "tone-direct",
  "translate",
] as const;
export type ModeId = (typeof MODE_IDS)[number];

export function isModeId(x: unknown): x is ModeId {
  return typeof x === "string" && (MODE_IDS as readonly string[]).includes(x);
}

export type EnglishVariant = "us" | "uk";

export interface PromptOptions {
  /** English spelling convention for English output. */
  englishVariant?: EnglishVariant;
  /** Translate only: target language; undefined = auto toggle EN/RO. */
  targetLanguage?: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export interface Mode {
  readonly id: ModeId;
  /** `nonce` is injectable for deterministic tests; defaults to a random generator. */
  buildPrompt(text: string, opts: PromptOptions, nonce?: NonceGenerator): BuiltPrompt;
  readonly defaultModel: string;
  readonly temperature: number;
}

const OPENAI_DEFAULT_MODEL = "gpt-5-mini";

interface ModeSpec {
  task: string | ((opts: PromptOptions) => string);
  temperature: number;
}

// Keyed by ModeId, so a missing or misspelled key does not compile; each Mode's id comes from its key.
const SPECS: Readonly<Record<ModeId, ModeSpec>> = {
  "fix-only": { task: FIX_ONLY_TASK, temperature: 0 },
  "fix-improve": { task: FIX_IMPROVE_TASK, temperature: 0.2 },
  shorten: { task: SHORTEN_TASK, temperature: 0.2 },
  "tone-professional": { task: TONE_TASKS.professional, temperature: 0.3 },
  "tone-friendly": { task: TONE_TASKS.friendly, temperature: 0.3 },
  "tone-casual": { task: TONE_TASKS.casual, temperature: 0.3 },
  "tone-confident": { task: TONE_TASKS.confident, temperature: 0.3 },
  "tone-direct": { task: TONE_TASKS.direct, temperature: 0.3 },
  translate: { task: translateTask, temperature: 0.1 },
};

function makeMode(id: ModeId, { task, temperature }: ModeSpec): Mode {
  return {
    id,
    defaultModel: OPENAI_DEFAULT_MODEL,
    temperature,
    buildPrompt: (text, opts, nonce) => buildPrompt(typeof task === "function" ? task(opts) : task, text, opts, nonce),
  };
}

export const modes: Readonly<Record<ModeId, Mode>> = Object.freeze(
  Object.fromEntries(MODE_IDS.map((id) => [id, makeMode(id, SPECS[id])])) as Record<ModeId, Mode>,
);
