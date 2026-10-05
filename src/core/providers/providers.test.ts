import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "./index";
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

const openaiOk = (text: string) => json({ choices: [{ message: { content: text } }] });
const anthropicOk = (text: string) => json({ content: [{ type: "text", text }] });

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

  it("maps caller abort to timeout", async () => {
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
    await expect(p).rejects.toMatchObject({ kind: "timeout" });
  });

  it("already-aborted signal rejects with timeout", async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) =>
      init.signal?.aborted
        ? Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        : Promise.resolve(ok("x")),
    );
    await expect(make().complete({ ...req, signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: "timeout" });
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
