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

/** Loads the last-used tone via the injected reader; storage failures fall back to the default order. */
export async function loadOrderedTones(getItem: (key: string) => Promise<string | undefined>): Promise<Tone[]> {
  try {
    return orderTones(await getItem(LAST_TONE_KEY));
  } catch (err) {
    console.error("Could not read last tone:", err);
    return orderTones();
  }
}

export const LAST_TONE_KEY = "lastTone";
