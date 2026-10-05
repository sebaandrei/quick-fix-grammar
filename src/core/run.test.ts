import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_CHARS, InputError, MAX_OUTPUT_RATIO, MAX_OUTPUT_SLACK_CHARS, runMode } from "./run";
import { modes } from "./modes";
import { ProviderError, type LLMProvider } from "./providers/types";

const mk = (impl: LLMProvider["complete"]) => {
  const complete = vi.fn(impl);
  return { provider: { complete } as LLMProvider, complete };
};

describe("runMode", () => {
  it("calls provider with mode prompt/model/temperature and sanitizes", async () => {
    const { provider, complete } = mk(async () => 'Here is the fixed text:\n\n"Hello world."');
    const out = await runMode("fix-only", "  hello world\n", { provider, englishVariant: "uk" });
    expect(out).toBe("  Hello world.\n");
    const req = complete.mock.calls[0][0];
    expect(req.model).toBe(modes["fix-only"].defaultModel);
    expect(req.temperature).toBe(modes["fix-only"].temperature);
    expect(req.system).toMatch(/British/);
    expect(req.user).toContain("hello world");
  });

  it("model override, targetLanguage and signal pass through", async () => {
    const { provider, complete } = mk(async () => "Hallo");
    const signal = new AbortController().signal;
    await runMode("translate", "hello", { provider, model: " custom ", targetLanguage: "German", signal });
    const req = complete.mock.calls[0][0];
    expect(req.model).toBe("custom");
    expect(req.system).toContain("German");
    expect(req.signal).toBe(signal);
  });

  it("empty input -> InputError(empty), provider not called", async () => {
    const { provider, complete } = mk(async () => "x");
    const err = await runMode("shorten", " \n\t", { provider }).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect(err.kind).toBe("empty");
    expect(complete).not.toHaveBeenCalled();
  });

  it("too long -> InputError(too_long); default 4000, configurable", async () => {
    const { provider, complete } = mk(async () => "ok");
    await expect(runMode("shorten", "a".repeat(4001), { provider })).rejects.toMatchObject({ kind: "too_long" });
    await expect(runMode("shorten", "a".repeat(4000), { provider })).resolves.toBe("ok");
    await expect(runMode("shorten", "abcdef", { provider, maxChars: 5 })).rejects.toBeInstanceOf(InputError);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("ProviderError passes through", async () => {
    const { provider } = mk(async () => {
      throw new ProviderError("auth", "nope", 401);
    });
    await expect(runMode("fix-improve", "hi", { provider })).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  it("unknown mode throws before calling the provider", async () => {
    const { provider, complete } = mk(async () => "x");
    await expect(runMode("bogus" as never, "hi", { provider })).rejects.toThrow(/Unknown mode: bogus/);
    await expect(runMode("toString" as never, "hi", { provider })).rejects.toThrow(/Unknown mode/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("whitespace padding counts toward the limit", async () => {
    const { provider, complete } = mk(async () => "ok");
    const err = await runMode("shorten", `  ${"a".repeat(4)}\n\n`, { provider, maxChars: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect(err).toMatchObject({ name: "InputError", kind: "too_long", limit: 5, length: 8 });
    expect(err.message).toMatch(/8 characters; limit is 5/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("InputError(empty) has no limit/length", async () => {
    const { provider } = mk(async () => "x");
    const err = await runMode("shorten", "  ", { provider }).catch((e) => e);
    expect(err.limit).toBeUndefined();
    expect(err.length).toBeUndefined();
  });

  it.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -5],
    ["fractional", 2.5],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["string", "10" as unknown as number],
  ])("invalid maxChars (%s) falls back to the default", async (_n, maxChars) => {
    const { provider } = mk(async () => "ok");
    await expect(runMode("shorten", "a".repeat(DEFAULT_MAX_CHARS), { provider, maxChars })).resolves.toBe("ok");
    await expect(runMode("shorten", "a".repeat(DEFAULT_MAX_CHARS + 1), { provider, maxChars })).rejects.toMatchObject({
      kind: "too_long",
      limit: DEFAULT_MAX_CHARS,
    });
  });

  it("DEFAULT_MAX_CHARS is 4000", () => {
    expect(DEFAULT_MAX_CHARS).toBe(4000);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "  \n "],
    ["only quotes", '""'],
    ["only fence", "```\n```"],
  ])("blank after sanitize (%s) -> ProviderError(bad_response)", async (_n, raw) => {
    const { provider } = mk(async () => raw);
    const err = await runMode("fix-only", "hello", { provider }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: "bad_response", message: "Model returned no usable text" });
  });

  it("passes mode to sanitize (translate keeps a 'Here is' header)", async () => {
    const { provider } = mk(async () => "Here is the list:\n- a");
    await expect(runMode("translate", "Aici e lista\n- a", { provider })).resolves.toBe("Here is the list:\n- a");
  });
});

describe("output length guard", () => {
  const answering = (text: string): LLMProvider => ({ complete: vi.fn(async () => text) });
  const limit = (inputLen: number) => inputLen * MAX_OUTPUT_RATIO + MAX_OUTPUT_SLACK_CHARS;

  it.each(["fix-only", "fix-improve", "shorten", "tone-casual", "translate"] as const)(
    "%s rejects an answer far longer than the input",
    async (mode) => {
      const input = "hello there";
      const tooLong = "x".repeat(limit(input.length) + 1);
      await expect(runMode(mode, input, { provider: answering(tooLong) })).rejects.toMatchObject({
        name: "ProviderError",
        kind: "bad_response",
        message: expect.stringMatching(/much longer than the input/),
      });
    },
  );

  it("accepts an answer exactly at the limit and a normal expansion", async () => {
    const input = "hello there";
    await expect(
      runMode("fix-only", input, { provider: answering("x".repeat(limit(input.length))) }),
    ).resolves.toBeTruthy();
    await expect(
      runMode("translate", "Hello", { provider: answering("Bună ziua, ce mai faceți astăzi?") }),
    ).resolves.toBeTruthy();
  });
});
