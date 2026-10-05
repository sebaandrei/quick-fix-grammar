import {
  Clipboard,
  PopToRootType,
  getFrontmostApplication,
  Toast,
  closeMainWindow,
  getSelectedText,
  showHUD,
  showToast,
} from "@raycast/api";
import type { ModeId } from "../core/modes";
import { createProvider } from "../core/providers";
import { DEFAULT_MAX_CHARS, runMode } from "../core/run";
import { toUserMessage } from "./errors";
import { getExtensionConfig, validateConfig } from "./preferences";
import { modelFor } from "./resolve";
import {
  hudFor,
  labelsFor,
  readSelection as readSelectionWith,
  replaceSelection as replaceWith,
} from "./selection-core";
import type { SelectionDeps } from "./selection-core";

const deps: SelectionDeps = {
  readClipboard: async () => {
    const { text, html, file } = await Clipboard.read();
    return { text, html, file };
  },
  copy: (content, options) => Clipboard.copy(content, options),
  paste: (text) => Clipboard.paste(text),
  clear: () => Clipboard.clear(),
  getSelectedText,
  frontmostApp: async () => {
    const app = await getFrontmostApplication();
    return app.bundleId ?? app.path;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const readSelection = () => readSelectionWith(deps);

export interface FlowOptions {
  /** Model override for this command; the provider fallback is applied when empty. */
  model?: string;
  targetLanguage?: string;
  /** Selection captured earlier (change-tone). */
  selected?: string;
}

/** Logs the full error for debugging (never the user's text) and shows a HUD; never throws. */
export async function reportError(err: unknown): Promise<void> {
  console.error(err);
  try {
    const { title, message } = toUserMessage(err);
    await showHUD(`${title}: ${message}`);
  } catch (hudErr) {
    console.error("Could not show error HUD:", hudErr);
  }
}

/** Shared no-view flow: validate -> close window -> toast -> run -> paste -> HUD. */
export async function runNoViewCommand(modeId: ModeId, opts: FlowOptions = {}): Promise<void> {
  try {
    const cfg = getExtensionConfig();
    // Resolve here (idempotent for an already-resolved opts.model) so a caller that forgets the model can never
    // send the OpenAI mode default to another provider.
    const model = modelFor({
      provider: cfg.provider,
      model: opts.model,
      defaultModel: cfg.defaultModel,
      baseUrl: cfg.baseUrl,
    });
    validateConfig(cfg, model);
    const labels = labelsFor(modeId);
    await closeMainWindow({ popToRootType: PopToRootType.Immediate });
    await showToast({ style: Toast.Style.Animated, title: labels.progress });
    const provider = createProvider({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    const outcome = await replaceWith(
      deps,
      (text) =>
        runMode(modeId, text, {
          provider,
          model,
          englishVariant: cfg.englishVariant,
          targetLanguage: opts.targetLanguage,
          maxChars: DEFAULT_MAX_CHARS,
        }),
      opts.selected,
    );
    await showHUD(hudFor(outcome, labels));
  } catch (err) {
    await reportError(err);
  }
}
