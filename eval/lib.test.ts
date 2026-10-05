import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  costUSD,
  envKeyFor,
  estimateTokens,
  extractPreservables,
  hasPreamble,
  parseModelSpec,
  parseSamples,
  percentile,
  runChecks,
  summarize,
  type CallRecord,
  type Sample,
} from "./lib";

const base = (o: Partial<Sample>): Sample => ({ id: "x", mode: "fix-only", input: "", tags: [], ...o });
const failed = (s: Sample, out: string) =>
  runChecks(s, out)
    .filter((c) => !c.pass)
    .map((c) => c.name);

describe("stats", () => {
  it("percentile nearest-rank", () => {
    const v = [5, 1, 3, 2, 4, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNaN();
  });
  it("cost and tokens", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(costUSD(1_000_000, 500_000, { input: 1, output: 2 })).toBeCloseTo(2);
    expect(costUSD(10, 10, undefined)).toBeNull();
  });
  it("summarize", () => {
    const rec = (id: string, ms: number, pass = true, error?: string): CallRecord => ({
      sampleId: id,
      mode: "fix-only",
      run: 1,
      latencyMs: ms,
      output: error ? null : "o",
      error,
      inputTokens: 1,
      outputTokens: 1,
      costUSD: 0.01,
      checks: pass ? [] : [{ name: "must", pass: false }],
      pass,
    });
    const s = summarize(
      [rec("a", 100), rec("ac", 1500), rec("b", 300, false), rec("c", 0, false, "boom")],
      new Set(["ac"]),
    );
    expect(s.errors).toBe(1);
    expect(s.p50).toBe(300);
    expect(s.acP95).toBe(1500);
    expect(s.passRate).toBe(0.5);
    expect(s.checkFailures.must).toBe(2);
  });
});

describe("parseModelSpec", () => {
  it("parses the three forms", () => {
    expect(parseModelSpec("openai:gpt-5-mini")).toMatchObject({ provider: "openai", model: "gpt-5-mini" });
    expect(parseModelSpec("anthropic:claude-haiku-4-5-20251001").provider).toBe("anthropic");
    const c = parseModelSpec("openai-compatible@https://openrouter.ai/api/v1:google/gemini-2.5-flash-lite");
    expect(c).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash-lite" });
    expect(envKeyFor(c)).toBe("OPENROUTER_API_KEY");
    expect(parseModelSpec("openai-compatible@http://localhost:11434/v1:llama3:8b")).toMatchObject({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3:8b",
    });
  });
  it("rejects garbage", () => {
    expect(() => parseModelSpec("gpt-5")).toThrow();
  });
});

describe("checks", () => {
  it("unchanged-when-correct", () => {
    const s = base({ input: "All good.", tags: ["correct"] });
    expect(failed(s, "All good.")).toEqual([]);
    expect(failed(s, "All good!")).toContain("unchanged");
  });
  it("diacritics preserved and cedilla rejected", () => {
    const s = base({ input: "Mâine și țara", tags: ["ro-diacritics"] });
    expect(failed(s, "Mâine și țara")).toEqual([]);
    expect(failed(s, "Maine si tara")).toContain("diacritics");
    expect(failed(s, "Mâine şi țara")).toContain("noCedilla");
  });
  it("expect-diacritics", () => {
    const s = base({ input: "Maine si", tags: ["expect-diacritics"] });
    expect(failed(s, "Mâine și")).toEqual([]);
    expect(failed(s, "Maine si")).toContain("hasDiacritics");
  });
  it("preamble and wrapper", () => {
    expect(hasPreamble("Here is the corrected text: hi")).toBe(true);
    expect(hasPreamble("Hello there")).toBe(false);
    const s = base({ input: "teh cat" });
    expect(failed(s, '"the cat"')).toContain("noWrapper");
    expect(failed(s, "```\nthe cat\n```")).toContain("noWrapper");
    expect(failed(s, "Sure, the cat")).toContain("noPreamble");
    expect(failed(s, "the cat")).toEqual([]);
  });
  it("code, urls, mentions, emoji preserved", () => {
    const input = "ping @bob see https://a.io/x?y=1. run `npm i` 🙏\n```js\nx()\n```";
    expect(extractPreservables(input).sort()).toEqual(
      ["@bob", "https://a.io/x?y=1", "`npm i`", "🙏", "```js\nx()\n```"].sort(),
    );
    const s = base({ input });
    expect(failed(s, input)).toEqual([]);
    expect(failed(s, "ping @bob see https://a.io/x run `npm i`")).toContain("preserved");
  });
  it("must / mustNot / expected (case-insensitive substrings)", () => {
    const s = base({ input: "i", must: ["Hello"], mustNot: ["pwned"], expected: "Hello world" });
    expect(failed(s, "Hello world")).toEqual([]);
    expect(failed(s, "PWNED")).toEqual(expect.arrayContaining(["must", "mustNot", "expected"]));
  });
  it("tone/shorten need change; shorten needs shorter", () => {
    const t = base({ mode: "tone-casual", input: "same" });
    expect(failed(t, "same")).toContain("changed");
    const sh = base({ mode: "shorten", input: "a long sentence here" });
    expect(failed(sh, "a long sentence here too")).toContain("shorter");
    expect(failed(sh, "short one")).toEqual([]);
  });
});

describe("samples.jsonl", () => {
  const samples = parseSamples(readFileSync(join(__dirname, "samples.jsonl"), "utf8"));
  it("is well-formed with unique ids and broad coverage", () => {
    expect(samples.length).toBeGreaterThanOrEqual(30);
    expect(new Set(samples.map((s) => s.id)).size).toBe(samples.length);
    const modes = new Set(samples.map((s) => s.mode));
    for (const m of ["fix-only", "fix-improve", "shorten", "translate", "tone-professional", "tone-direct"]) {
      expect(modes.has(m as Sample["mode"])).toBe(true);
    }
    for (const t of ["ro-diacritics", "correct", "injection", "markdown", "long", "latency-ac", "missing-diacritics"]) {
      expect(samples.some((s) => s.tags.includes(t))).toBe(true);
    }
  });
  it("expected outputs pass their own checks", () => {
    for (const s of samples) {
      const out = s.expected ?? (s.tags.includes("correct") ? s.input : undefined);
      if (out !== undefined) expect(failed(s, out), s.id).toEqual([]);
    }
  });
  it("latency-ac sample is ~100 words", () => {
    const s = samples.find((x) => x.tags.includes("latency-ac"))!;
    const words = s.input.split(/\s+/).length;
    expect(words).toBeGreaterThan(80);
    expect(words).toBeLessThan(130);
  });
});
