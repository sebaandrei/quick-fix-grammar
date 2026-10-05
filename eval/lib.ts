/** Pure scoring / stats helpers for eval/bench.ts. No I/O, no network. */

import { isModeId, type EnglishVariant, type ModeId } from "../src/core/modes";
import type { ProviderId } from "../src/core/providers/types";

export interface Sample {
  id: string;
  mode: ModeId;
  input: string;
  /** Exact expected output (compared after trim + NFC). */
  expected?: string;
  /** Substrings the output must contain (case-insensitive). */
  must?: string[];
  /** Substrings the output must NOT contain (case-insensitive). */
  mustNot?: string[];
  /**
   * Tags with built-in meaning: correct (must be unchanged), ro-diacritics (diacritics of expected/input must
   * survive; skipped for translate samples, where the output language differs), keep-header (input starts with a header
   * line that the output must keep, so the noPreamble check is skipped), latency-ac (the sample whose p95
   * is checked against the 2 s acceptance criterion), expect-diacritics (output must contain >= 1 Romanian diacritic), shorter (output shorter than input),
   * injection (informational; the must/mustNot lists do the work).
   */
  tags: string[];
  englishVariant?: EnglishVariant;
  targetLanguage?: string;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export const RO_DIACRITICS = /[ăâîșț]/i;
const CEDILLA = /[şţŞŢ]/;

const norm = (s: string) => s.normalize("NFC").trim();
const lc = (s: string) => s.toLowerCase();

/** Pieces of the input that must survive verbatim: fenced/inline code, URLs, @mentions, emoji. */
export function extractPreservables(input: string): string[] {
  const out: string[] = [];
  let rest = input;
  for (const m of rest.match(/```[\s\S]*?```/g) ?? []) out.push(m);
  rest = rest.replace(/```[\s\S]*?```/g, " ");
  for (const m of rest.match(/`[^`\n]+`/g) ?? []) out.push(m);
  rest = rest.replace(/`[^`\n]+`/g, " ");
  for (const m of rest.match(/https?:\/\/[^\s)>\]]+/g) ?? []) out.push(m.replace(/[.,;:!?]+$/, ""));
  for (const m of rest.match(/(?:^|\s)@[\w.-]+/g) ?? []) out.push(m.trim().replace(/[.,;:!?]+$/, ""));
  for (const m of rest.match(/\p{Extended_Pictographic}/gu) ?? []) out.push(m);
  return [...new Set(out)];
}

const PREAMBLE =
  /^\s*(here('s| is| are)|sure[,!. ]|certainly|of course|okay[,!. ]|corrected( text| version)?:|fixed( text| version)?:|revised( text| version)?:|translation:|iat[ăa]|bine[iî]n[țt]eles|desigur|textul corectat)/i;

export function hasPreamble(output: string): boolean {
  return PREAMBLE.test(output);
}

export function isWrapped(input: string, output: string): boolean {
  const o = output.trim();
  const i = input.trim();
  const fenced = o.startsWith("```") && o.endsWith("```") && !i.startsWith("```");
  const quoted = o.length > 1 && /^["“„«'‘].*["”»'’]$/s.test(o) && !/^["“„«'‘]/.test(i);
  return fenced || quoted;
}

export function runChecks(sample: Sample, output: string): CheckResult[] {
  const r: CheckResult[] = [];
  const add = (name: string, pass: boolean, detail?: string) => r.push({ name, pass, ...(detail ? { detail } : {}) });
  const out = norm(output);
  const tags = new Set(sample.tags);

  add("nonEmpty", out.length > 0);
  // keep-header: the input legitimately starts with a "Here is ...:" style header, so one in the output is correct.
  if (!tags.has("keep-header")) add("noPreamble", !hasPreamble(output));
  add("noWrapper", !isWrapped(sample.input, output));
  add("noCedilla", !CEDILLA.test(output), "uses cedilla s/t instead of comma-below");

  if (sample.expected !== undefined) add("expected", out === norm(sample.expected));
  if (tags.has("correct")) add("unchanged", out === norm(sample.input));

  for (const p of extractPreservables(sample.input)) add("preserved", output.includes(p), p);

  for (const s of sample.must ?? []) add("must", lc(out).includes(lc(s.normalize("NFC"))), s);
  for (const s of sample.mustNot ?? []) add("mustNot", !lc(out).includes(lc(s.normalize("NFC"))), s);

  if (tags.has("ro-diacritics") && sample.mode !== "translate") {
    const src = (sample.expected ?? sample.input).normalize("NFC");
    const want = [...new Set(src.match(/[ăâîșțĂÂÎȘȚ]/g) ?? [])];
    const missing = want.filter((c) => !out.includes(c));
    add("diacritics", missing.length === 0, missing.length ? `missing ${missing.join("")}` : undefined);
  }
  if (tags.has("expect-diacritics")) add("hasDiacritics", RO_DIACRITICS.test(out));

  const needsChange = sample.mode !== "fix-only" && sample.mode !== "fix-improve" && !tags.has("correct");
  if (needsChange) add("changed", out !== norm(sample.input));
  if (sample.mode === "shorten" || tags.has("shorter")) add("shorter", out.length < norm(sample.input).length);

  return r;
}

export function failedChecks(results: CheckResult[]): CheckResult[] {
  return results.filter((c) => !c.pass);
}

/** Nearest-rank percentile. Returns NaN for an empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface Price {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export function costUSD(inputTokens: number, outputTokens: number, price: Price | undefined): number | null {
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export interface ModelSpec {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  label: string;
}

/**
 * Parses `openai:gpt-5-mini`, `anthropic:claude-haiku-4-5-20251001` or
 * `openai-compatible@https://openrouter.ai/api/v1:google/gemini-2.5-flash-lite`.
 */
export function parseModelSpec(raw: string): ModelSpec {
  const s = raw.trim();
  const compat = /^openai-compatible@(https?:\/\/[^/:\s]+(?::\d+)?(?:\/[^:\s]*)?):(.+)$/.exec(s);
  if (compat) return { provider: "openai-compatible", baseUrl: compat[1], model: compat[2], label: s };
  const plain = /^(openai|anthropic):(.+)$/.exec(s);
  if (plain) return { provider: plain[1] as "openai" | "anthropic", model: plain[2], label: s };
  throw new Error(`Invalid model spec: "${raw}"`);
}

export function parseModelList(list: string): ModelSpec[] {
  return list
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(parseModelSpec);
}

export function envKeyFor(spec: ModelSpec): string {
  if (spec.provider === "openai") return "OPENAI_API_KEY";
  if (spec.provider === "anthropic") return "ANTHROPIC_API_KEY";
  let host = "";
  try {
    host = new URL(spec.baseUrl ?? "").hostname.toLowerCase();
  } catch {
    // no/invalid base URL: fall through to the generic key
  }
  const isOpenRouter = host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  return isOpenRouter ? "OPENROUTER_API_KEY" : "OPENAI_COMPATIBLE_API_KEY";
}

export interface CallError {
  kind: string;
  status?: number;
  message: string;
}

/** Normalizes anything thrown by runMode/providers into a serializable error. */
export function toCallError(e: unknown): CallError {
  if (e instanceof Error) {
    const x = e as Error & { kind?: unknown; status?: unknown };
    return {
      kind: typeof x.kind === "string" ? x.kind : "unknown",
      ...(typeof x.status === "number" ? { status: x.status } : {}),
      message: e.message,
    };
  }
  return { kind: "unknown", message: String(e) };
}

/** Errors that will keep failing for every sample (bad key, bad URL/model), so a model run should stop early. */
export function isFatalCallError(e: CallError): boolean {
  return e.kind === "auth" || e.kind === "request";
}

export interface CallRecord {
  sampleId: string;
  mode: ModeId;
  run: number;
  latencyMs: number;
  output: string | null;
  error?: CallError;
  inputTokens: number;
  outputTokens: number;
  costUSD: number | null;
  checks: CheckResult[];
  pass: boolean;
}

export interface ModelSummary {
  calls: number;
  errors: number;
  errorRate: number;
  passRate: number;
  /** Latency percentiles include errored calls (a timeout is a slow call, not a missing one). */
  p50: number;
  p95: number;
  meanCostUSD: number | null;
  /** p95 over samples tagged "latency-ac" (the ~100-word Fix input), errored calls included. */
  acP95: number | null;
  /** False when any latency-ac call errored: the AC verdict then rests on failed calls and cannot be trusted. */
  acReliable: boolean;
  checkFailures: Record<string, number>;
}

export function summarize(records: CallRecord[], acSampleIds: Set<string>): ModelSummary {
  const ok = records.filter((r) => !r.error);
  const lat = records.map((r) => r.latencyMs);
  const costs = ok.map((r) => r.costUSD).filter((c): c is number => c !== null);
  const acRecs = records.filter((r) => acSampleIds.has(r.sampleId));
  const checkFailures: Record<string, number> = {};
  for (const r of records)
    for (const c of failedChecks(r.checks)) checkFailures[c.name] = (checkFailures[c.name] ?? 0) + 1;
  return {
    calls: records.length,
    errors: records.length - ok.length,
    errorRate: records.length ? (records.length - ok.length) / records.length : 0,
    passRate: records.length ? records.filter((r) => r.pass).length / records.length : NaN,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    meanCostUSD: costs.length ? mean(costs) : null,
    acP95: acRecs.length
      ? percentile(
          acRecs.map((r) => r.latencyMs),
          95,
        )
      : null,
    acReliable: acRecs.length > 0 && acRecs.every((r) => !r.error),
    checkFailures,
  };
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Validates one parsed JSONL value; throws with `where` in the message. */
export function assertSample(v: unknown, where: string): asserts v is Sample {
  const fail = (why: string): never => {
    throw new Error(`Invalid sample (${where}): ${why}`);
  };
  if (typeof v !== "object" || v === null || Array.isArray(v)) return fail("not an object");
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) fail("id must be a non-empty string");
  if (!isModeId(o.mode)) fail(`unknown mode ${JSON.stringify(o.mode)}`);
  if (typeof o.input !== "string") fail("input must be a string");
  if (!isStringArray(o.tags)) fail("tags must be an array of strings");
  if (o.expected !== undefined && typeof o.expected !== "string") fail("expected must be a string");
  if (o.must !== undefined && !isStringArray(o.must)) fail("must must be an array of strings");
  if (o.mustNot !== undefined && !isStringArray(o.mustNot)) fail("mustNot must be an array of strings");
  if (o.englishVariant !== undefined && o.englishVariant !== "us" && o.englishVariant !== "uk")
    fail('englishVariant must be "us" or "uk"');
  if (o.targetLanguage !== undefined && typeof o.targetLanguage !== "string") fail("targetLanguage must be a string");
}

export function parseSamples(jsonl: string): Sample[] {
  const seen = new Set<string>();
  const out: Sample[] = [];
  jsonl.split("\n").forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("//")) return;
    const where = `line ${i + 1}`;
    let v: unknown;
    try {
      v = JSON.parse(l);
    } catch (e) {
      throw new Error(`Invalid sample (${where}): ${e instanceof Error ? e.message : String(e)}`);
    }
    assertSample(v, where);
    if (seen.has(v.id)) throw new Error(`Invalid sample (${where}): duplicate id "${v.id}"`);
    seen.add(v.id);
    out.push(v);
  });
  return out;
}

/** Strict CLI parsing for eval/bench.ts: unknown flags, missing values and a non-positive --runs all throw. */
export interface BenchArgs {
  models: string;
  runs: number;
  filter: string[];
  dryRun: boolean;
  out: string;
}

export function parseBenchArgs(argv: string[], defaultOut: string): BenchArgs {
  const a: BenchArgs = { models: "", runs: 3, filter: [], dryRun: false, out: defaultOut };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`Missing value for ${v}`);
      return next;
    };
    if (v === "--dry-run") a.dryRun = true;
    else if (v === "--models") a.models = value();
    else if (v === "--runs") {
      const raw = value();
      const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
      if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--runs must be a positive integer, got "${raw}"`);
      a.runs = n;
    } else if (v === "--filter") a.filter = value().split(",").filter(Boolean);
    else if (v === "--out") a.out = value();
    else if (!v.startsWith("--")) a.models = v;
    else throw new Error(`Unknown flag ${v}`);
  }
  return a;
}
