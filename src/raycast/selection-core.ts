import type { ModeId } from "../core/modes";
import { ProviderError } from "../core/providers/types";
import { NoSelectionError, SelectionReadError } from "./errors";

/** Delay before restoring the clipboard so the target app finishes reading the pasted text. */
export const RESTORE_DELAY_MS = 600;

export interface ClipboardSnapshot {
  text?: string;
  html?: string;
  file?: string;
}

export type CopyContent = { file: string } | { html: string; text?: string } | { text: string };

/** Everything the paste flow needs from the host; injected so this module never imports @raycast. */
export interface SelectionDeps {
  readClipboard(): Promise<ClipboardSnapshot>;
  copy(content: CopyContent, options?: { concealed?: boolean }): Promise<void>;
  paste(text: string): Promise<void>;
  clear(): Promise<void>;
  getSelectedText(): Promise<string>;
  sleep(ms: number): Promise<void>;
}

export type ReplaceOutcome = "replaced" | "unchanged" | "replaced_clipboard_not_restored";

const EMPTY_SELECTION_RE = /unable to get selected text|no (text )?selected|nothing (is )?selected/i;
const ACCESSIBILITY_RE = /accessib|not trusted|permission/i;

/** Only a genuinely empty selection becomes NoSelectionError; other failures keep their message. */
export async function readSelection(deps: Pick<SelectionDeps, "getSelectedText">): Promise<string> {
  let text: string;
  try {
    text = await deps.getSelectedText();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (EMPTY_SELECTION_RE.test(message) && !ACCESSIBILITY_RE.test(message)) throw new NoSelectionError();
    throw new SelectionReadError(message || "unknown error");
  }
  if (!text || !text.trim()) throw new NoSelectionError();
  return text;
}

function contentFor(snap: ClipboardSnapshot): CopyContent | undefined {
  if (snap.file) return { file: snap.file };
  if (snap.html) return { html: snap.html, text: snap.text };
  if (snap.text) return { text: snap.text };
  return undefined;
}

/**
 * Snapshot clipboard -> read selection -> transform -> paste -> restore clipboard.
 * Nothing is pasted if transform throws or yields blank/unchanged text. The clipboard is only
 * touched again if a paste was attempted, and only when the snapshot held something restorable;
 * it is never cleared.
 */
export async function replaceSelection(
  deps: SelectionDeps,
  transform: (text: string) => Promise<string>,
  selected?: string,
): Promise<ReplaceOutcome> {
  let snapshot: ClipboardSnapshot | undefined;
  try {
    snapshot = await deps.readClipboard();
  } catch (err) {
    console.error("Could not read clipboard; it will not be restored:", err);
  }

  const text = selected ?? (await readSelection(deps));
  const result = await transform(text);
  if (!result.trim()) throw new ProviderError("bad_response", "Empty result");
  if (result === text) return "unchanged";

  let restored = false;
  try {
    await deps.paste(result);
  } finally {
    // Reached whether or not paste threw: a paste was attempted, so the clipboard may have changed.
    restored = snapshot ? await restoreClipboard(deps, snapshot) : false;
  }
  return restored ? "replaced" : "replaced_clipboard_not_restored";
}

async function restoreClipboard(deps: SelectionDeps, snap: ClipboardSnapshot): Promise<boolean> {
  try {
    // An empty snapshot is ambiguous: the clipboard was empty, or held something we cannot read back
    // (an image, rich text). Either way there is nothing we can restore, so never clear (that would
    // also drop the result for no benefit) and report that the clipboard was not restored.
    const content = contentFor(snap);
    if (!content) return false;
    await deps.sleep(RESTORE_DELAY_MS);
    await deps.copy(content, { concealed: true });
    return true;
  } catch (err) {
    console.error("Could not restore clipboard:", err);
    return false;
  }
}

export interface ModeLabels {
  progress: string;
  done: string;
  /** Shown when the model returned the text unchanged. */
  unchanged: string;
}

const FIX: ModeLabels = { progress: "Fixing…", done: "Fixed ✓", unchanged: "No changes needed" };
const TONE: ModeLabels = {
  progress: "Rewriting…",
  done: "Rewritten ✓",
  unchanged: "The model returned the text unchanged",
};

/** Exhaustive over ModeId, so a new mode cannot silently inherit another mode's wording. */
const LABELS: Record<ModeId, ModeLabels> = {
  "fix-only": FIX,
  "fix-improve": FIX,
  shorten: {
    progress: "Shortening…",
    done: "Shortened ✓",
    unchanged: "The model returned the text unchanged",
  },
  translate: {
    progress: "Translating…",
    done: "Translated ✓",
    unchanged: "The model returned the text unchanged (not translated)",
  },
  "tone-professional": TONE,
  "tone-friendly": TONE,
  "tone-casual": TONE,
  "tone-confident": TONE,
  "tone-direct": TONE,
};

export function labelsFor(modeId: ModeId): ModeLabels {
  return LABELS[modeId];
}

export function hudFor(outcome: ReplaceOutcome, labels: ModeLabels): string {
  if (outcome === "unchanged") return labels.unchanged;
  if (outcome === "replaced_clipboard_not_restored") return `${labels.done} (clipboard could not be restored)`;
  return labels.done;
}
