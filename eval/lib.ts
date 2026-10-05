/** Pure scoring / stats helpers for eval/bench.ts. No I/O, no network. */

export type SampleMode =
  | "fix-only"
  | "fix-improve"
  | "shorten"
  | "tone-professional"
  | "tone-friendly"
  | "tone-casual"
  | "tone-confident"
  | "tone-direct"
  | "translate";

export interface Sample {
  id: string;
  mode: SampleMode;
  input: string;
  /** Exact expected output (compared after trim + NFC). */
  expected?: string;
  /** Substrings the output must contain (case-insensitive). */
  must?: string[];
  /** Substrings the output must NOT contain (case-insensitive). */
  mustNot?: string[];
  /**
   * Tags with built-in meaning: correct (must be unchanged), ro-diacritics (diacritics of expected/input must
   * survive), expect-diacritics (output must contain >= 1 Romanian diacritic), shorter (output shorter than input),
   * injection (informational; the must/mustNot lists do the work).
   */
  tags: string[];
  englishVariant?: "us" | "uk";
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
  add("noPreamble", !hasPreamble(output));
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
  provider: "openai" | "anthropic" | "openai-compatible";
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
  return /openrouter/i.test(spec.baseUrl ?? "") ? "OPENROUTER_API_KEY" : "OPENAI_COMPATIBLE_API_KEY";
}

export interface CallRecord {
  sampleId: string;
  mode: string;
  run: number;
  latencyMs: number;
  output: string | null;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number | null;
  checks: CheckResult[];
  pass: boolean;
}

export interface ModelSummary {
  calls: number;
  errors: number;
  passRate: number;
  p50: number;
  p95: number;
  meanCostUSD: number | null;
  /** p95 over samples tagged "latency-ac" (the ~100-word Fix input). */
  acP95: number | null;
  checkFailures: Record<string, number>;
}

export function summarize(records: CallRecord[], acSampleIds: Set<string>): ModelSummary {
  const ok = records.filter((r) => !r.error);
  const lat = ok.map((r) => r.latencyMs);
  const costs = ok.map((r) => r.costUSD).filter((c): c is number => c !== null);
  const acLat = ok.filter((r) => acSampleIds.has(r.sampleId)).map((r) => r.latencyMs);
  const checkFailures: Record<string, number> = {};
  for (const r of records)
    for (const c of failedChecks(r.checks)) checkFailures[c.name] = (checkFailures[c.name] ?? 0) + 1;
  return {
    calls: records.length,
    errors: records.length - ok.length,
    passRate: records.length ? records.filter((r) => r.pass).length / records.length : NaN,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    meanCostUSD: costs.length ? mean(costs) : null,
    acP95: acLat.length ? percentile(acLat, 95) : null,
    checkFailures,
  };
}

export function parseSamples(jsonl: string): Sample[] {
  return jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l, i) => {
      const s = JSON.parse(l) as Sample;
      if (!s.id || !s.mode || typeof s.input !== "string" || !Array.isArray(s.tags)) {
        throw new Error(`Invalid sample on line ${i + 1}`);
      }
      return s;
    });
}
