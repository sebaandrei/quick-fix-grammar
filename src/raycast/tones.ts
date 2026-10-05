import type { ModeId } from "../core/modes";

export const TONES = [
  { id: "professional", title: "Professional", mode: "tone-professional" },
  { id: "friendly", title: "Friendly", mode: "tone-friendly" },
  { id: "casual", title: "Casual", mode: "tone-casual" },
  { id: "confident", title: "Confident", mode: "tone-confident" },
  { id: "direct", title: "Direct", mode: "tone-direct" },
] as const satisfies readonly { id: string; title: string; mode: ModeId }[];

export type Tone = (typeof TONES)[number];

/** Returns tones with the last used one first; unknown/missing last keeps default order. */
export function orderTones(lastId?: string | null): Tone[] {
  const last = TONES.find((t) => t.id === lastId);
  return last ? [last, ...TONES.filter((t) => t !== last)] : [...TONES];
}
