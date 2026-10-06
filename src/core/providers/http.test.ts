import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RESPONSE_BYTES, errorForStatus, joinUrl, postJson, readTextCapped } from "./http";
import { ProviderError } from "./types";

describe("joinUrl", () => {
  it.each([
    ["https://a.com/v1", "messages", "https://a.com/v1/messages"],
    ["https://a.com/v1/", "messages", "https://a.com/v1/messages"],
    ["https://a.com/v1///", "/messages", "https://a.com/v1/messages"],
    ["https://a.com/v1", "///chat/completions", "https://a.com/v1/chat/completions"],
    ["http://localhost:11434", "chat/completions", "http://localhost:11434/chat/completions"],
  ])("joinUrl(%s, %s)", (base, path, expected) => {
    expect(joinUrl(base, path)).toBe(expected);
  });
});

describe("errorForStatus", () => {
  it.each([
    [400, "request"],
    [404, "request"],
    [422, "request"],
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [402, "billing"],
    [408, "timeout"],
    [500, "bad_response"],
    [502, "bad_response"],
    [503, "bad_response"],
    [301, "bad_response"],
    [200, "bad_response"],
  ])("status %i -> %s", (status, kind) => {
    const e = errorForStatus(status, "detail here");
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.kind).toBe(kind);
    expect(e.status).toBe(status);
    expect(e.message).toContain(String(status));
    expect(e.message).toContain("detail here");
  });

  it("omits trailing space when detail is empty", () => {
    for (const s of [400, 401, 429, 500])
      expect(errorForStatus(s, "").message).toBe(errorForStatus(s, "").message.trim());
  });

  it("truncates detail to 300 chars", () => {
    const msg = errorForStatus(400, "x".repeat(1000)).message;
    expect(msg).toContain("x".repeat(300));
    expect(msg).not.toContain("x".repeat(301));
  });

  it("keeps short detail intact", () => {
    expect(errorForStatus(422, "x".repeat(300)).message).toContain("x".repeat(300));
  });
});

function streamOf(chunks: string[], onCancel?: () => void) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

describe("response size cap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a normal body in full, across chunks and multibyte characters", async () => {
    const res = new Response(streamOf(['{"a":"mulțumesc ', 'și ă"}']));
    expect(await readTextCapped(res)).toBe('{"a":"mulțumesc și ă"}');
  });

  it("rejects a declared size over the cap without reading the body", async () => {
    const res = new Response("x", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } });
    await expect(readTextCapped(res)).rejects.toMatchObject({ kind: "bad_response", message: /unexpectedly large/ });
  });

  it("stops a streamed body that exceeds the cap and cancels the stream", async () => {
    let cancelled = false;
    const big = "x".repeat(1024);
    const res = new Response(streamOf(new Array(2000).fill(big), () => (cancelled = true)));
    await expect(readTextCapped(res, 10 * 1024)).rejects.toMatchObject({ kind: "bad_response" });
    expect(cancelled).toBe(true);
  });

  it("postJson maps an oversized success body to bad_response and still parses normal JSON", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(streamOf(['{"ok":true}'])));
    expect(await postJson("https://x.example/v1", {}, {})).toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(
      new Response("x", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }),
    );
    await expect(postJson("https://x.example/v1", {}, {})).rejects.toMatchObject({
      name: "ProviderError",
      kind: "bad_response",
      message: expect.stringMatching(/unexpectedly large/),
    });
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    await expect(postJson("https://x.example/v1", {}, {})).rejects.toMatchObject({
      kind: "bad_response",
      message: expect.stringMatching(/not valid JSON/),
    });
  });

  it("an oversized error body becomes the placeholder detail, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("y", { status: 500, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }),
        ),
    );
    await expect(postJson("https://x.example/v1", {}, {})).rejects.toMatchObject({
      kind: "bad_response",
      message: expect.stringContaining("(could not read response body)"),
    });
  });
});

describe("postJson retry", () => {
  const url = "https://x.example/v1";
  const ok = () => new Response('{"ok":true}');
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([408, 429, 500, 502, 503])("retries once after status %i and returns the second answer", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("busy", { status })).mockResolvedValueOnce(ok());
    expect(await postJson(url, {}, {})).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once after a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok());
    expect(await postJson(url, {}, {})).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry and reports the last error", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    await expect(postJson(url, {}, {})).rejects.toMatchObject({ kind: "bad_response", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 402, 403, 404, 422])("does not retry status %i", async (status) => {
    fetchMock.mockResolvedValue(new Response("no", { status }));
    await expect(postJson(url, {}, {})).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a blocked redirect", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }));
    await expect(postJson(url, {}, {})).rejects.toMatchObject({ kind: "network", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a caller abort", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    await expect(postJson(url, {}, {}, controller.signal)).rejects.toMatchObject({ kind: "aborted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start the retry when the pause overran the deadline", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    const t0 = 1_000_000;
    // Reads: deadline, pre-sleep budget check, post-sleep recompute (the clock jumped, e.g. the Mac slept).
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(t0)
      .mockReturnValueOnce(t0 + 10)
      .mockReturnValueOnce(t0 + 5000);
    try {
      await expect(postJson(url, {}, {}, undefined, 1000)).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it("retries a retryable error thrown by the body check", async () => {
    fetchMock.mockImplementation(async () => ok());
    const check = vi
      .fn()
      .mockImplementationOnce(() => {
        throw errorForStatus(429, "slow down");
      })
      .mockImplementation(() => undefined);
    expect(await postJson(url, {}, {}, undefined, undefined, check)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the time budget is spent", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    await expect(postJson(url, {}, {}, undefined, 100)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
