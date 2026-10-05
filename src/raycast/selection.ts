import { Clipboard, Toast, closeMainWindow, getSelectedText, showHUD, showToast } from "@raycast/api";
import type { ModeId } from "../core/modes";
import { createProvider } from "../core/providers";
import { runMode } from "../core/run";
import { NoSelectionError, toUserMessage } from "./errors";
import { getExtensionConfig } from "./preferences";

const MAX_CHARS = 4000;
const RESTORE_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readSelection(): Promise<string> {
  let text: string;
  try {
    text = await getSelectedText();
  } catch {
    throw new NoSelectionError();
  }
  if (!text || !text.trim()) throw new NoSelectionError();
  return text;
}

async function restoreClipboard(prev: Clipboard.ReadContent): Promise<void> {
  const content: Clipboard.Content | undefined = prev.file
    ? { file: prev.file }
    : prev.html !== undefined && prev.html !== ""
      ? { html: prev.html, text: prev.text }
      : prev.text
        ? { text: prev.text }
        : undefined;
  if (content) await Clipboard.copy(content);
  else await Clipboard.clear();
}

/**
 * Snapshot clipboard -> read selection -> transform(text) -> paste -> restore clipboard.
 * Clipboard is always restored; nothing is pasted if transform throws.
 * `selected` may be supplied when the selection was captured earlier.
 */
export async function replaceSelection(transform: (text: string) => Promise<string>, selected?: string): Promise<void> {
  let prev: Clipboard.ReadContent = { text: "" };
  try {
    prev = await Clipboard.read();
  } catch {
    // unreadable clipboard: treat as empty
  }
  let pasted = false;
  try {
    const text = selected ?? (await readSelection());
    const result = await transform(text);
    await Clipboard.paste(result);
    pasted = true;
  } finally {
    if (pasted) await sleep(RESTORE_DELAY_MS);
    try {
      await restoreClipboard(prev);
    } catch {
      // best effort
    }
  }
}

export interface FlowOptions {
  model?: string;
  targetLanguage?: string;
  /** Selection captured earlier (change-tone). */
  selected?: string;
}

export async function reportError(err: unknown): Promise<void> {
  const { title, message } = toUserMessage(err);
  await showHUD(`${title}: ${message}`);
}

/** Shared no-view flow: close window -> toast -> run -> paste -> HUD. */
export async function runNoViewCommand(modeId: ModeId, opts: FlowOptions = {}): Promise<void> {
  const cfg = getExtensionConfig();
  try {
    await closeMainWindow();
    await showToast({ style: Toast.Style.Animated, title: "Fixing…" });
    const provider = createProvider({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    await replaceSelection(
      (text) =>
        runMode(modeId, text, {
          provider,
          model: opts.model,
          englishVariant: cfg.englishVariant,
          targetLanguage: opts.targetLanguage,
          maxChars: MAX_CHARS,
        }),
      opts.selected,
    );
    await showHUD("Fixed ✓");
  } catch (err) {
    await reportError(err);
  }
}
