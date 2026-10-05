import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  costUSD,
  envKeyFor,
  estimateTokens,
  extractPreservables,
  hasPreamble,
  isFatalCallError,
  parseBenchArgs,
  parseModelList,
  parseModelSpec,
  parseSamples,
  percentile,
  runChecks,
  summarize,
  type CallRecord,
  type Sample,
} from "./lib";
import { sanitize } from "../src/core/sanitize";

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
      error: error ? { kind: "network", message: error } : undefined,
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
    expect(s.errorRate).toBe(0.25);
    // errored call (0 ms here) is part of the latency distribution
    expect(s.p50).toBe(100);
    expect(s.p95).toBe(1500);
    expect(s.acP95).toBe(1500);
    expect(s.acReliable).toBe(true);
    expect(s.passRate).toBe(0.5);
    expect(s.checkFailures.must).toBe(2);
  });
  it("marks the AC verdict unreliable when a latency-ac call errored", () => {
    const mk = (ms: number, error?: string) =>
      ({
        sampleId: "ac",
        mode: "fix-only",
        run: 1,
        latencyMs: ms,
        output: null,
        error: error ? { kind: "timeout", message: error } : undefined,
        inputTokens: 1,
        outputTokens: 0,
        costUSD: null,
        checks: [],
        pass: false,
      }) as CallRecord;
    const s = summarize([mk(900), mk(10_000, "timed out")], new Set(["ac"]));
    expect(s.acP95).toBe(10_000);
    expect(s.acReliable).toBe(false);
  });
  it("fatal call errors are auth and request only", () => {
    expect(isFatalCallError({ kind: "auth", message: "x" })).toBe(true);
    expect(isFatalCallError({ kind: "request", message: "x" })).toBe(true);
    expect(isFatalCallError({ kind: "rate_limit", message: "x" })).toBe(false);
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

describe("parseModelList", () => {
  it("splits, trims and ignores empty entries", () => {
    const l = parseModelList(" openai:gpt-5-mini , ,anthropic:claude-haiku-4-5-20251001 ");
    expect(l.map((x) => x.label)).toEqual(["openai:gpt-5-mini", "anthropic:claude-haiku-4-5-20251001"]);
    expect(parseModelList("")).toEqual([]);
  });
  it("throws on an invalid entry", () => {
    expect(() => parseModelList("openai:gpt-5-mini,nonsense")).toThrow(/Invalid model spec/);
  });
});

describe("envKeyFor", () => {
  const compat = (baseUrl?: string) => envKeyFor({ provider: "openai-compatible", model: "m", baseUrl, label: "l" });
  it("maps providers to their env vars", () => {
    expect(envKeyFor(parseModelSpec("openai:gpt-5-mini"))).toBe("OPENAI_API_KEY");
    expect(envKeyFor(parseModelSpec("anthropic:claude-haiku-4-5-20251001"))).toBe("ANTHROPIC_API_KEY");
  });
  it("matches openrouter by hostname only", () => {
    expect(compat("https://openrouter.ai/api/v1")).toBe("OPENROUTER_API_KEY");
    expect(compat("https://eu.openrouter.ai/api/v1")).toBe("OPENROUTER_API_KEY");
    expect(compat("https://evil.example/openrouter.ai/v1")).toBe("OPENAI_COMPATIBLE_API_KEY");
    expect(compat("https://notopenrouter.ai/v1")).toBe("OPENAI_COMPATIBLE_API_KEY");
    expect(compat("http://localhost:11434/v1")).toBe("OPENAI_COMPATIBLE_API_KEY");
    expect(compat(undefined)).toBe("OPENAI_COMPATIBLE_API_KEY");
  });
});

describe("parseBenchArgs", () => {
  const parse = (...a: string[]) => parseBenchArgs(a, "/out");
  it("defaults and valid flags", () => {
    expect(parse("--dry-run")).toMatchObject({ runs: 3, dryRun: true, out: "/out" });
    expect(parse("--models", "a:b", "--runs", "5", "--filter", "x,y")).toMatchObject({
      models: "a:b",
      runs: 5,
      filter: ["x", "y"],
    });
  });
  it("parses --delay (default 0) and rejects bad values", () => {
    expect(parse("--dry-run").delay).toBe(0);
    expect(parse("--delay", "1500").delay).toBe(1500);
    for (const bad of ["-1", "abc", "1.5", ""]) expect(() => parse("--delay", bad)).toThrow(/--delay/);
    expect(() => parse("--delay")).toThrow(/Missing value/);
  });
  it("rejects bad --runs, missing values and unknown flags", () => {
    for (const bad of ["0", "-1", "abc", "2.5", "3x", ""]) expect(() => parse("--runs", bad)).toThrow(/--runs/);
    expect(() => parse("--runs")).toThrow(/Missing value/);
    expect(() => parse("--models", "--dry-run")).toThrow(/Missing value/);
    expect(() => parse("--out")).toThrow(/Missing value/);
    expect(() => parse("--nope")).toThrow(/Unknown flag/);
  });
});

describe("parseSamples", () => {
  const ok = (o: object = {}) => JSON.stringify({ id: "a", mode: "fix-only", input: "x", tags: [], ...o });
  it("accepts valid lines and skips blanks and // comments", () => {
    expect(parseSamples(`// c\n\n${ok()}\n${ok({ id: "b", englishVariant: "uk" })}\n`)).toHaveLength(2);
  });
  it("rejects invalid samples with the line number", () => {
    const bad: [object, RegExp][] = [
      [{ mode: "nope" }, /unknown mode/],
      [{ mode: "toString" }, /unknown mode/],
      [{ id: "" }, /id/],
      [{ input: 3 }, /input/],
      [{ tags: ["ok", 1] }, /tags/],
      [{ tags: "x" }, /tags/],
      [{ englishVariant: "au" }, /englishVariant/],
      [{ must: [1] }, /must/],
      [{ expected: 1 }, /expected/],
      [{ targetLanguage: 1 }, /targetLanguage/],
    ];
    for (const [o, re] of bad) expect(() => parseSamples(`\n${ok(o)}`), JSON.stringify(o)).toThrow(re);
    expect(() => parseSamples(`\n${ok({ id: "" })}`)).toThrow(/line 2/);
    expect(() => parseSamples("{not json")).toThrow(/line 1/);
    expect(() => parseSamples("[]")).toThrow(/not an object/);
  });
  it("rejects duplicate ids", () => {
    expect(() => parseSamples(`${ok()}\n${ok()}`)).toThrow(/duplicate id "a"/);
  });
});

describe("hasPreamble agrees with sanitize", () => {
  // Outputs the sanitizer strips a preamble from must also be flagged by the eval check.
  const preambled = [
    "Here is the corrected text:\n\nHello.",
    "Here's the fixed version:\nHello.",
    "Here are the results:\n\nHello.",
    "Sure! Here is your text:\n\nHello.",
    "Certainly, here is it:\nHello.",
    "Of course, here you go:\nHello.",
    "Okay, done:\nHello.",
  ];
  const clean = ["Hello there.", "Heres a typo", "Hello, here is a sentence.\nSecond line."];
  it.each(preambled)("flags %j and the sanitizer strips it", (out) => {
    expect(hasPreamble(out)).toBe(true);
    expect(sanitize(out, "hello")).toBe("Hello.");
  });
  it.each(clean)("does not flag %j and the sanitizer keeps it", (out) => {
    expect(hasPreamble(out)).toBe(false);
    expect(sanitize(out, "x").trim()).toBe(out.trim());
  });
});

describe("checks", () => {
  it("keep-header skips noPreamble", () => {
    const s = base({ input: "Heres what i need:\n- a", tags: ["keep-header"] });
    expect(failed(s, "Here's what I need:\n- a")).toEqual([]);
    expect(failed(base({ input: "Heres what i need:\n- a" }), "Here's what I need:\n- a")).toContain("noPreamble");
  });
  it("ro-diacritics is skipped for translate", () => {
    const s = base({ mode: "translate", input: "Mâine și țara", tags: ["ro-diacritics"] });
    expect(failed(s, "Tomorrow and the country")).not.toContain("diacritics");
  });
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
