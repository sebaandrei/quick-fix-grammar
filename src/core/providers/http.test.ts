import { describe, expect, it } from "vitest";
import { errorForStatus, joinUrl } from "./http";
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
    [402, "bad_response"],
    [408, "bad_response"],
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
