import { MODE_IDS } from "../core/modes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "../core/providers/types";
import { NoSelectionError, SelectionReadError } from "./errors";
import {
  RAYCAST_BUNDLE_ID,
  RESTORE_DELAY_MS,
  hudFor,
  labelsFor,
  readSelection,
  replaceSelection,
  type ClipboardSnapshot,
  type SelectionDeps,
} from "./selection-core";

function makeDeps(over: Partial<SelectionDeps> & { clip?: ClipboardSnapshot } = {}) {
  const calls: string[] = [];
  const deps: SelectionDeps = {
    readClipboard: vi.fn(async () => over.clip ?? { text: "orig clip" }),
    copy: vi.fn(async () => void calls.push("copy")),
    paste: vi.fn(async () => void calls.push("paste")),
    clear: vi.fn(async () => void calls.push("clear")),
    getSelectedText: vi.fn(async () => "hello"),
    frontmostApp: vi.fn(async () => "com.example.editor"),
    sleep: vi.fn(async () => void calls.push("sleep")),
    ...over,
  };
  return { deps, calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("replaceSelection", () => {
  it("pastes, waits, then restores concealed", async () => {
    const { deps, calls } = makeDeps();
    const out = await replaceSelection(deps, async () => "Hello");
    expect(out).toBe("replaced");
    expect(deps.paste).toHaveBeenCalledWith("Hello");
    expect(deps.sleep).toHaveBeenCalledWith(RESTORE_DELAY_MS);
    expect(RESTORE_DELAY_MS).toBe(600);
    expect(calls).toEqual(["paste", "sleep", "copy"]);
    expect(deps.copy).toHaveBeenCalledWith({ text: "orig clip" }, { concealed: true });
    expect(deps.clear).not.toHaveBeenCalled();
  });

  it("uses a pre-captured selection", async () => {
    const { deps } = makeDeps();
    await replaceSelection(deps, async (t) => t + "!", "given");
    expect(deps.getSelectedText).not.toHaveBeenCalled();
    expect(deps.paste).toHaveBeenCalledWith("given!");
  });

  it("transform throws: no paste, clipboard untouched", async () => {
    const { deps } = makeDeps();
    const boom = new ProviderError("timeout", "slow");
    await expect(replaceSelection(deps, async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(deps.paste).not.toHaveBeenCalled();
    expect(deps.copy).not.toHaveBeenCalled();
    expect(deps.clear).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("clipboard read fails: paste still works but is never cleared or restored", async () => {
    const { deps } = makeDeps({
      readClipboard: vi.fn(async () => {
        throw new Error("unreadable");
      }),
    });
    const out = await replaceSelection(deps, async () => "Hello");
    expect(out).toBe("replaced_clipboard_not_restored");
    expect(deps.paste).toHaveBeenCalled();
    expect(deps.clear).not.toHaveBeenCalled();
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("clipboard read fails and transform throws: never cleared", async () => {
    const { deps } = makeDeps({
      readClipboard: vi.fn(async () => {
        throw new Error("unreadable");
      }),
    });
    await expect(replaceSelection(deps, async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(deps.clear).not.toHaveBeenCalled();
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it.each([
    ["file", { file: "/tmp/a.png", html: "<b>x</b>", text: "x" }, { file: "/tmp/a.png" }],
    ["html+text", { html: "<b>x</b>", text: "x" }, { html: "<b>x</b>", text: "x" }],
    ["text", { text: "x" }, { text: "x" }],
  ])("restore priority: %s", async (_n, clip, expected) => {
    const { deps } = makeDeps({ clip });
    await replaceSelection(deps, async () => "Hello");
    expect(deps.copy).toHaveBeenCalledWith(expected, { concealed: true });
    expect(deps.clear).not.toHaveBeenCalled();
  });

  it("an empty snapshot (empty or unreadable clipboard such as an image) is never cleared and is reported", async () => {
    for (const clip of [{ text: "" }, {}, { text: undefined, html: "", file: "" }]) {
      const { deps } = makeDeps({ clip });
      const outcome = await replaceSelection(deps, async () => "Hello");
      expect(outcome).toBe("replaced_clipboard_not_restored");
      expect(deps.clear).not.toHaveBeenCalled();
      expect(deps.copy).not.toHaveBeenCalled();
    }
  });

  it("reports failed restore after a successful paste", async () => {
    const { deps } = makeDeps({
      copy: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const out = await replaceSelection(deps, async () => "Hello");
    expect(out).toBe("replaced_clipboard_not_restored");
    expect(hudFor(out, labelsFor("fix-improve"))).toBe("Fixed ✓ (clipboard could not be restored)");
  });

  it("paste throws: error propagates and clipboard is restored", async () => {
    const { deps } = makeDeps({
      paste: vi.fn(async () => {
        throw new Error("paste failed");
      }),
    });
    await expect(replaceSelection(deps, async () => "Hello")).rejects.toThrow("paste failed");
    expect(deps.copy).toHaveBeenCalledWith({ text: "orig clip" }, { concealed: true });
  });

  it.each(["", "   ", "\n\t"])("refuses blank result %j", async (blank) => {
    const { deps } = makeDeps();
    const p = replaceSelection(deps, async () => blank);
    await expect(p).rejects.toBeInstanceOf(ProviderError);
    await expect(p).rejects.toMatchObject({ kind: "bad_response" });
    expect(deps.paste).not.toHaveBeenCalled();
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("unchanged result skips paste and clipboard work", async () => {
    const { deps } = makeDeps();
    const out = await replaceSelection(deps, async (t) => t);
    expect(out).toBe("unchanged");
    expect(deps.paste).not.toHaveBeenCalled();
    expect(deps.copy).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(hudFor(out, labelsFor("shorten"))).toBe("The model returned the text unchanged");
    expect(hudFor(out, labelsFor("fix-only"))).toBe("No changes needed");
    expect(hudFor(out, labelsFor("translate"))).toMatch(/not translated/);
  });

  it("selection errors propagate before any paste", async () => {
    const { deps } = makeDeps({
      getSelectedText: vi.fn(async () => {
        throw new Error("Unable to get selected text from frontmost application");
      }),
    });
    await expect(replaceSelection(deps, async () => "x")).rejects.toBeInstanceOf(NoSelectionError);
    expect(deps.paste).not.toHaveBeenCalled();
    expect(deps.copy).not.toHaveBeenCalled();
  });
});

describe("readSelection", () => {
  const withGet = (fn: () => Promise<string>) => ({ getSelectedText: fn });

  it("returns text", async () => {
    expect(await readSelection(withGet(async () => "hi"))).toBe("hi");
  });
  it.each(["", "  \n"])("blank text %j is NoSelectionError", async (v) => {
    await expect(readSelection(withGet(async () => v))).rejects.toBeInstanceOf(NoSelectionError);
  });
  it("empty-selection failure is NoSelectionError", async () => {
    await expect(
      readSelection(withGet(() => Promise.reject(new Error("Unable to get selected text from frontmost application")))),
    ).rejects.toBeInstanceOf(NoSelectionError);
  });
  it("other failures surface with their message", async () => {
    const p = readSelection(withGet(() => Promise.reject(new Error("Accessibility permission denied"))));
    await expect(p).rejects.toBeInstanceOf(SelectionReadError);
    await expect(p).rejects.toThrow("Could not read selection: Accessibility permission denied");
  });
  it("non-Error rejection surfaces", async () => {
    await expect(readSelection(withGet(() => Promise.reject("weird")))).rejects.toThrow(
      "Could not read selection: weird",
    );
  });
});

describe("frontmost app check", () => {
  /** frontmostApp returns these in order, then repeats the last one. */
  const sequence = (...apps: (string | undefined | Error)[]) => {
    let i = 0;
    return vi.fn(async () => {
      const v = apps[Math.min(i++, apps.length - 1)];
      if (v instanceof Error) throw v;
      return v;
    });
  };

  it("pastes when the same app is frontmost before and after", async () => {
    const { deps } = makeDeps({ frontmostApp: sequence("com.a", "com.a") });
    expect(await replaceSelection(deps, async () => "Hello")).toBe("replaced");
    expect(deps.paste).toHaveBeenCalledWith("Hello");
  });

  it("does not paste after the user switched apps: result goes to the clipboard, unrestored", async () => {
    const { deps } = makeDeps({ frontmostApp: sequence("com.a", "com.slack") });
    const outcome = await replaceSelection(deps, async () => "Hello");
    expect(outcome).toBe("focus_changed");
    expect(deps.paste).not.toHaveBeenCalled();
    expect(deps.copy).toHaveBeenCalledTimes(1);
    expect(deps.copy).toHaveBeenCalledWith({ text: "Hello" });
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(hudFor(outcome, labelsFor("fix-only"))).toMatch(/clipboard, not pasted/);
  });

  it("does not paste when Raycast itself was opened during the request", async () => {
    const { deps } = makeDeps({ frontmostApp: sequence("com.a", RAYCAST_BUNDLE_ID) });
    expect(await replaceSelection(deps, async () => "Hello")).toBe("focus_changed");
    expect(deps.paste).not.toHaveBeenCalled();
  });

  it("waits while Raycast is still closing, then uses the app that appears as the target", async () => {
    const { deps } = makeDeps({ frontmostApp: sequence(RAYCAST_BUNDLE_ID, RAYCAST_BUNDLE_ID, "com.a", "com.a") });
    expect(await replaceSelection(deps, async () => "Hello")).toBe("replaced");
    expect(deps.sleep).toHaveBeenCalledWith(100);
    expect(deps.paste).toHaveBeenCalledWith("Hello");
  });

  it("does not enforce when the target stays unknown (Raycast never leaves, or the app cannot be read)", async () => {
    for (const frontmostApp of [
      sequence(RAYCAST_BUNDLE_ID),
      sequence(undefined),
      sequence(new Error("no api")),
      sequence("com.a", undefined),
      sequence("com.a", new Error("no api")),
    ]) {
      const { deps } = makeDeps({ frontmostApp });
      expect(await replaceSelection(deps, async () => "Hello")).toBe("replaced");
      expect(deps.paste).toHaveBeenCalledTimes(1);
    }
  });

  it("an unchanged result needs no focus check and never touches the clipboard", async () => {
    const { deps } = makeDeps({ frontmostApp: sequence("com.a", "com.b") });
    expect(await replaceSelection(deps, async (t) => t)).toBe("unchanged");
    expect(deps.copy).not.toHaveBeenCalled();
    expect(deps.paste).not.toHaveBeenCalled();
  });
});

describe("labels", () => {
  it("covers every mode", () => {
    for (const id of MODE_IDS) expect(labelsFor(id).progress).toBeTruthy();
  });
  it.each([
    ["fix-only", "Fixing…", "Fixed ✓"],
    ["fix-improve", "Fixing…", "Fixed ✓"],
    ["shorten", "Shortening…", "Shortened ✓"],
    ["translate", "Translating…", "Translated ✓"],
    ["tone-casual", "Rewriting…", "Rewritten ✓"],
    ["tone-direct", "Rewriting…", "Rewritten ✓"],
  ] as const)("%s", (mode, progress, done) => {
    expect(labelsFor(mode)).toMatchObject({ progress, done });
    expect(hudFor("replaced", labelsFor(mode))).toBe(done);
  });
});
