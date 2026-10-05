import { describe, expect, it } from "vitest";

import { ProviderError, type ProviderErrorKind } from "../core/providers/types";
import { InputError } from "../core/run";
import { ConfigError, NoSelectionError, SelectionReadError, toUserMessage } from "./errors";

describe("toUserMessage", () => {
  it("no selection", () => {
    expect(toUserMessage(new NoSelectionError())).toEqual({
      title: "No text selected",
      message: "Select some text first, then run the command.",
    });
  });

  it("selection read error keeps the cause and hints at Accessibility", () => {
    const m = toUserMessage(new SelectionReadError("denied"));
    expect(m.title).toBe("Could not read selection");
    expect(m.message).toContain("Could not read selection: denied");
    expect(m.message).toContain("Accessibility");
  });

  it("input errors", () => {
    expect(toUserMessage(new InputError("empty", "x"))).toEqual({
      title: "Nothing to fix",
      message: "The selection is empty.",
    });
    const long = toUserMessage(new InputError("too_long", "x"));
    expect(long.title).toBe("Text too long");
    expect(long.message).toContain("4,000");
  });

  it("too_long uses the error's limit", () => {
    const e = Object.assign(new InputError("too_long", "x"), { limit: 1500 });
    expect(toUserMessage(e).message).toContain("1,500");
    expect(toUserMessage(e).message).not.toContain("4,000");
  });

  const cases: [ProviderErrorKind, string, RegExp][] = [
    ["auth", "Invalid API key", /Invalid API key or no access/],
    ["rate_limit", "Rate limited", /Too many requests/],
    ["timeout", "Request timed out", /too long/],
    ["network", "Network error", /Could not reach the provider/],
    ["billing", "Out of credits", /Add credits or check billing/],
    ["bad_response", "Bad response", /detail 404 model not found\. Try again, or try a different model/],
    ["aborted", "Cancelled", /cancelled/],
    ["request", "Request rejected", /model name exists for the selected provider/],
  ];
  it.each(cases)("provider %s", (kind, title, re) => {
    const m = toUserMessage(new ProviderError(kind, "detail 404 model not found"));
    expect(m.title).toBe(title);
    expect(m.message).toMatch(re);
  });

  it("403 is reported as access denied (moderation or model access), not an invalid key", () => {
    const m = toUserMessage(new ProviderError("auth", "forbidden", 403));
    expect(m.title).toBe("Access denied");
    expect(m.message).toMatch(/moderation/);
    expect(toUserMessage(new ProviderError("auth", "nope", 401)).title).toBe("Invalid API key");
  });
  it("bad_response shows a short, single-line provider detail", () => {
    const long = `Request failed with status 502.\n${"x".repeat(500)}`;
    const m = toUserMessage(new ProviderError("bad_response", long));
    expect(m.message).not.toMatch(/\n/);
    expect(m.message.length).toBeLessThan(300);
    expect(toUserMessage(new ProviderError("bad_response", "")).message).toMatch(/unexpected or empty/);
  });
  it("network message mentions the base URL only conditionally", () => {
    expect(toUserMessage(new ProviderError("network", "x")).message).toMatch(/if you use OpenAI-compatible/);
  });
  it("auth message has no status code", () => {
    expect(toUserMessage(new ProviderError("auth", "x", 401)).message).not.toMatch(/40\d/);
  });

  it("request includes provider detail", () => {
    const m = toUserMessage(new ProviderError("request", "HTTP 404: model 'foo' not found", 404));
    expect(m.message).toContain("HTTP 404: model 'foo' not found");
  });

  it.each([
    ["missing_api_key", "API key missing", /API key/],
    ["missing_base_url", "Base URL missing", /Base URL/],
    ["missing_model", "Model missing", /Default Model/],
  ] as const)("config %s", (kind, title, re) => {
    const m = toUserMessage(new ConfigError(kind));
    expect(m.title).toBe(title);
    expect(m.message).toMatch(re);
    expect(m.message).toContain("preferences");
  });

  it("generic Error passes its message through", () => {
    expect(toUserMessage(new Error("boom"))).toEqual({ title: "Something went wrong", message: "boom" });
  });

  it("non-Error throwables", () => {
    expect(toUserMessage("plain string").message).toBe("plain string");
    expect(toUserMessage("").message).toBe("Unknown error");
    expect(toUserMessage(null).message).toBe("Unknown error");
    expect(toUserMessage(undefined).message).toBe("Unknown error");
    expect(toUserMessage({ foo: 1 }).title).toBe("Something went wrong");
  });

  it("does not misclassify look-alike plain errors", () => {
    const fake = Object.assign(new Error("x"), { name: "ProviderError", kind: "auth" });
    expect(toUserMessage(fake).title).toBe("Something went wrong");
  });
});
