import { describe, expect, it, vi } from "vitest";
import { InputError, runMode } from "./run";
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
});
