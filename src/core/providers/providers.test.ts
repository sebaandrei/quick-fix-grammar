import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateMaxTokens } from "./anthropic";
import { APP_TITLE, APP_URL } from "./attribution";
import { createProvider } from "./index";
import { isFixedTemperatureModel, isOfficialBaseUrl, supportsMinimalReasoning } from "./openai";
import { ProviderError, type LLMProvider } from "./types";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const openaiOk = (text: string) => json({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
const anthropicOk = (text: string) => json({ content: [{ type: "text", text }], stop_reason: "end_turn" });

const req = { system: "sys", user: "hello", model: "m", temperature: 0.2 };

const providers: [string, () => LLMProvider, (t: string) => Response][] = [
  ["openai", () => createProvider({ provider: "openai", apiKey: "k" }), openaiOk],
  [
    "openai-compatible",
    () => createProvider({ provider: "openai-compatible", apiKey: "k", baseUrl: "http://localhost:11434/v1/" }),
    openaiOk,
  ],
  ["anthropic", () => createProvider({ provider: "anthropic", apiKey: "k" }), anthropicOk],
];

describe.each(providers)("%s contract", (_n, make, ok) => {
  it("returns text", async () => {
    fetchMock.mockResolvedValue(ok("Fixed."));
    expect(await make().complete(req)).toBe("Fixed.");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [400, "request"],
    [404, "request"],
    [422, "request"],
    [500, "bad_response"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    fetchMock.mockResolvedValue(json({ error: "x" }, status));
    await expect(make().complete(req)).rejects.toMatchObject({ name: "ProviderError", kind, status });
  });

  it("maps fetch failure to network", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(make().complete(req)).rejects.toMatchObject({ kind: "network" });
  });

  it("maps non-JSON body to bad_response", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(make().complete(req)).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("maps empty/malformed JSON to bad_response", async () => {
    fetchMock.mockResolvedValue(json({ nothing: true }));
    const err = await make()
      .complete(req)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("bad_response");
  });

  it("maps caller abort to aborted", async () => {
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const ac = new AbortController();
    const p = make().complete({ ...req, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });

  it("already-aborted signal rejects with aborted", async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) =>
      init.signal?.aborted
        ? Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        : Promise.resolve(ok("x")),
    );
    await expect(make().complete({ ...req, signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: "aborted" });
  });

  it("request error includes status and provider detail", async () => {
    fetchMock.mockResolvedValue(json({ error: { message: "model not found" } }, 404));
    const err = await make()
      .complete(req)
      .catch((e) => e);
    expect(err.kind).toBe("request");
    expect(err.message).toContain("404");
    expect(err.message).toContain("model not found");
  });

  it("unreadable error body uses placeholder detail", async () => {
    const res = new Response("x", { status: 500 });
    vi.spyOn(res, "text").mockRejectedValue(new Error("boom"));
    fetchMock.mockResolvedValue(res);
    await expect(make().complete(req)).rejects.toMatchObject({
      kind: "bad_response",
      message: expect.stringContaining("(could not read response body)"),
    });
  });

  it("network error keeps cause", async () => {
    const cause = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(cause);
    const err = await make()
      .complete(req)
      .catch((e) => e);
    expect(err.cause).toBe(cause);
  });

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["newlines", "\n\t\n"],
  ])("rejects blank content (%s)", async (_n, text) => {
    fetchMock.mockResolvedValue(ok(text));
    await expect(make().complete(req)).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("times out after 10s", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const p = make().complete(req);
    const assertion = expect(p).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });
});

describe("openai request shape", () => {
  it("sends bearer auth, chat/completions, messages, temperature", async () => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({ provider: "openai", apiKey: "sk-1" }).complete({ ...req, model: "gpt-4.1-mini" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-1");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
  });

  it("omits temperature for gpt-5 on official API", async () => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({ provider: "openai", apiKey: "k" }).complete({ ...req, model: "gpt-5-mini" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBeUndefined();
  });

  it("uses custom baseUrl (trailing slash tolerated) and keeps temperature", async () => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({
      provider: "openai-compatible",
      apiKey: "k",
      baseUrl: "http://localhost:11434/v1/",
    }).complete({
      ...req,
      model: "gpt-5-mini",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(JSON.parse(init.body).temperature).toBe(0.2);
  });
});

describe("anthropic request shape", () => {
  it("sends x-api-key, version header, system, max_tokens sized from input", async () => {
    fetchMock.mockImplementation(async () => anthropicOk("x"));
    const p = createProvider({ provider: "anthropic", apiKey: "ak" });
    await p.complete({ ...req, user: "a".repeat(100) });
    await p.complete({ ...req, user: "a".repeat(4000) });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("ak");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const b1 = JSON.parse(init.body);
    expect(b1.system).toBe("sys");
    expect(b1.messages).toEqual([{ role: "user", content: "a".repeat(100) }]);
    expect(b1.temperature).toBe(0.2);
    const b2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(b2.max_tokens).toBeGreaterThan(b1.max_tokens);
    expect(b1.max_tokens).toBeGreaterThanOrEqual(100);
  });

  it("joins multiple text blocks and ignores others", async () => {
    fetchMock.mockResolvedValue(
      json({ content: [{ type: "thinking" }, { type: "text", text: "a" }, { type: "text", text: "b" }] }),
    );
    expect(await createProvider({ provider: "anthropic", apiKey: "k" }).complete(req)).toBe("ab");
  });
});

describe("response edge cases", () => {
  const openai = () => createProvider({ provider: "openai", apiKey: "k" });
  const anthropic = () => createProvider({ provider: "anthropic", apiKey: "k" });

  it.each([
    ["choices: []", { choices: [] }],
    ["content: null", { choices: [{ message: { content: null } }] }],
    ["no message", { choices: [{}] }],
    ["choices not array", { choices: "x" }],
    ["null body", null],
  ])("openai %s -> bad_response", async (_n, body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(openai().complete(req)).rejects.toMatchObject({ name: "ProviderError", kind: "bad_response" });
  });

  it.each([
    ["length", /cut off/],
    ["content_filter", /content filter/],
  ])("openai finish_reason %s -> bad_response", async (finish_reason, msg) => {
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: "partial" }, finish_reason }] }));
    const err = await openai()
      .complete(req)
      .catch((e) => e);
    expect(err).toMatchObject({ kind: "bad_response" });
    expect(err.message).toMatch(msg);
  });

  it("openai finish_reason stop and unknown pass", async () => {
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: "ok" }, finish_reason: "tool_calls" }] }));
    await expect(openai().complete(req)).resolves.toBe("ok");
  });

  it.each([
    ["max_tokens", /cut off/],
    ["refusal", /refused/],
  ])("anthropic stop_reason %s -> bad_response", async (stop_reason, msg) => {
    fetchMock.mockResolvedValue(json({ content: [{ type: "text", text: "partial" }], stop_reason }));
    const err = await anthropic()
      .complete(req)
      .catch((e) => e);
    expect(err).toMatchObject({ kind: "bad_response" });
    expect(err.message).toMatch(msg);
  });

  it.each([
    ["content: []", { content: [] }],
    ["blank text", { content: [{ type: "text", text: "  " }] }],
    ["no content", {}],
  ])("anthropic %s -> bad_response", async (_n, body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(anthropic().complete(req)).rejects.toMatchObject({ kind: "bad_response" });
  });
});

describe("estimateMaxTokens", () => {
  it.each([
    [0, 512],
    [1, 512],
    [100, 512],
    [4000, 6256],
    [100_000, 8192],
  ])("estimateMaxTokens(%i) = %i", (n, expected) => {
    expect(estimateMaxTokens(n)).toBe(expected);
  });

  it("is monotonic non-decreasing, floored at 512, capped at 8192", () => {
    let prev = 0;
    for (let n = 0; n <= 10_000; n += 37) {
      const t = estimateMaxTokens(n);
      expect(t).toBeGreaterThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(512);
      expect(t).toBeLessThanOrEqual(8192);
      prev = t;
    }
  });

  it("leaves real headroom over the input length at the 4000 char limit", () => {
    expect(estimateMaxTokens(4000)).toBeGreaterThan(4000);
  });

  it("is sent as max_tokens", async () => {
    fetchMock.mockResolvedValue(anthropicOk("x"));
    await createProvider({ provider: "anthropic", apiKey: "k" }).complete({ ...req, user: "a".repeat(1000) });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(estimateMaxTokens(1000));
  });
});

describe("openai model handling", () => {
  it.each([
    ["gpt-5", true],
    ["gpt-5-mini", true],
    ["gpt-5-nano", true],
    ["GPT-5-Mini", true],
    ["gpt-5-mini-2025-08-07", true],
    ["gpt-5-2025-08-07", true],
    ["gpt-5-nano-2025-08-07", true],
    ["gpt-5.1", false],
    ["gpt-5-codex", false],
    ["gpt-5-chat-latest", false],
    ["gpt-5-pro", false],
    ["gpt-5-mini-preview", false],
    ["gpt-4.1-mini", false],
    ["o3-mini", false],
  ])("supportsMinimalReasoning(%s) = %s", (model, expected) => {
    expect(supportsMinimalReasoning(model)).toBe(expected);
  });

  it.each([
    ["gpt-5-mini", "minimal"],
    ["gpt-5-mini-2025-08-07", "minimal"],
    ["gpt-5.1", undefined],
    ["gpt-4.1", undefined],
    ["o3-mini", undefined],
  ])("sends reasoning_effort for %s -> %s on official API", async (model, effort) => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({ provider: "openai", apiKey: "k" }).complete({ ...req, model });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe(effort);
  });

  it("never sends reasoning_effort to non-official endpoints", async () => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({ provider: "openai-compatible", apiKey: "k", baseUrl: "http://x/v1" }).complete({
      ...req,
      model: "gpt-5-mini",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBeUndefined();
  });

  it.each([
    ["o1", true],
    ["o3-mini", true],
    ["o4-mini", true],
    ["gpt-5-mini", true],
    ["gpt-4.1", false],
    ["gpt-4o", false],
  ])("isFixedTemperatureModel(%s) = %s", (model, expected) => {
    expect(isFixedTemperatureModel(model)).toBe(expected);
  });

  it.each([
    ["o3-mini", undefined],
    ["gpt-4o", 0.2],
  ])("temperature for %s on official API = %s", async (model, temp) => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({ provider: "openai", apiKey: "k" }).complete({ ...req, model });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(temp);
  });

  it.each([
    ["https://api.openai.com/v1", true],
    ["https://api.openai.com/v1/", true],
    ["https://api.openai.com/v1///", true],
    ["  https://api.openai.com/v1/  ", true],
    ["HTTPS://API.OPENAI.COM/v1", true],
    ["https://api.openai.com/v2", false],
    ["https://openrouter.ai/api/v1", false],
  ])("isOfficialBaseUrl(%j) = %s", (url, expected) => {
    expect(isOfficialBaseUrl(url)).toBe(expected);
  });

  it("sends app attribution headers to OpenRouter only", async () => {
    fetchMock.mockImplementation(async () => openaiOk("x"));
    for (const baseUrl of ["https://openrouter.ai/api/v1", " https://OpenRouter.ai/api/v1/ "]) {
      fetchMock.mockClear();
      await createProvider({ provider: "openai-compatible", apiKey: "k", baseUrl }).complete({ ...req, model: "m" });
      const { headers } = fetchMock.mock.calls[0][1];
      expect(headers["HTTP-Referer"]).toBe(APP_URL);
      expect(headers["X-OpenRouter-Title"]).toBe(APP_TITLE);
      expect(headers["X-OpenRouter-App-Visibility"]).toBe("hidden");
      expect(headers.Authorization).toBe("Bearer k");
    }
    for (const baseUrl of [
      "https://api.openai.com/v1",
      "http://localhost:11434/v1",
      "https://evil.example/openrouter.ai/v1",
      "https://notopenrouter.ai/v1",
    ]) {
      fetchMock.mockClear();
      await createProvider({ provider: "openai-compatible", apiKey: "k", baseUrl }).complete({ ...req, model: "m" });
      const { headers } = fetchMock.mock.calls[0][1];
      expect(Object.keys(headers).some((h) => /referer|x-openrouter/i.test(h))).toBe(false);
    }
  });

  it("openrouter provider uses the fixed OpenRouter URL with attribution, ignoring any stale baseUrl", async () => {
    fetchMock.mockImplementation(async () => openaiOk("x"));
    for (const baseUrl of [undefined, "https://api.openai.com/v1", "https://evil.example/v1"]) {
      fetchMock.mockClear();
      await createProvider({ provider: "openrouter", apiKey: "or-key", baseUrl }).complete({
        ...req,
        model: "google/gemini-3.1-flash-lite",
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer or-key");
      expect(init.headers["X-OpenRouter-Title"]).toBe(APP_TITLE);
      const body = JSON.parse(init.body);
      expect(body.model).toBe("google/gemini-3.1-flash-lite");
      expect(body.reasoning_effort).toBeUndefined();
    }
  });

  it("whitespace/trailing-slash official baseUrl still gets official behavior", async () => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({ provider: "openai", apiKey: "k", baseUrl: " https://api.openai.com/v1/ " }).complete({
      ...req,
      model: "gpt-5-mini",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.temperature).toBeUndefined();
  });
});

describe("createProvider config", () => {
  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("openai-compatible with %s baseUrl throws request error", (_n, baseUrl) => {
    let err: unknown;
    try {
      createProvider({ provider: "openai-compatible", apiKey: "k", baseUrl });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: "request", message: "Base URL is required for OpenAI-compatible providers" });
  });

  it("openai without baseUrl uses the official one", async () => {
    fetchMock.mockResolvedValue(openaiOk("x"));
    await createProvider({ provider: "openai", apiKey: "k" }).complete(req);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("error classes", () => {
  it("ProviderError has name, kind, status and cause", () => {
    const cause = new Error("c");
    const e = new ProviderError("network", "m", 500, { cause });
    expect(e).toMatchObject({ name: "ProviderError", kind: "network", status: 500, message: "m" });
    expect(e.cause).toBe(cause);
    expect(e).toBeInstanceOf(Error);
  });
});
