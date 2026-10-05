import { describe, expect, it } from "vitest";

import { NoSelectionError, toUserMessage } from "./errors";
import { levelToMode, resolveModel } from "./resolve";
import { TONES, orderTones } from "./tones";

function err(name: string, kind: string) {
  return Object.assign(new Error("x"), { name, kind });
}

describe("toUserMessage", () => {
  it.each([
    [new NoSelectionError(), "No text selected"],
    [err("InputError", "empty"), "Nothing to fix"],
    [err("InputError", "too_long"), "Text too long"],
    [err("ProviderError", "auth"), "Invalid API key"],
    [err("ProviderError", "rate_limit"), "Rate limited"],
    [err("ProviderError", "timeout"), "Request timed out"],
    [err("ProviderError", "network"), "Network error"],
    [err("ProviderError", "bad_response"), "Bad response"],
    [new Error("boom"), "Something went wrong"],
  ])("maps %#", (e, title) => {
    expect(toUserMessage(e).title).toBe(title);
  });
  it("includes unknown message", () => {
    expect(toUserMessage(new Error("boom")).message).toBe("boom");
  });
});

describe("orderTones", () => {
  it("default order", () => expect(orderTones().map((t) => t.id)).toEqual(TONES.map((t) => t.id)));
  it("puts last first", () => {
    const o = orderTones("casual");
    expect(o[0].id).toBe("casual");
    expect(o).toHaveLength(TONES.length);
  });
  it("ignores unknown", () => expect(orderTones("zzz")[0].id).toBe("professional"));
});

describe("preferences", () => {
  it("resolveModel precedence", () => {
    expect(resolveModel("a", "b")).toBe("a");
    expect(resolveModel("  ", "b")).toBe("b");
    expect(resolveModel(undefined, undefined)).toBeUndefined();
  });
  it("levelToMode", () => {
    expect(levelToMode("fix-only")).toBe("fix-only");
    expect(levelToMode("fix-improve")).toBe("fix-improve");
    expect(levelToMode(undefined)).toBe("fix-improve");
  });
});
