/**
 * Model benchmark: runs eval/samples.jsonl against candidate models through the real runMode() pipeline.
 *
 *   npx tsx eval/bench.ts --models openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001 --runs 3
 *   npx tsx eval/bench.ts --dry-run          # fake provider, no keys needed
 *
 * Flags: --models <list> (or positional) | --runs N (default 3) | --filter <id-or-tag,...> | --delay <ms> (pause before each call, for rate-limited free tiers) | --dry-run | --out <dir>
 * Keys come from OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY (OPENAI_COMPATIBLE_API_KEY for other bases).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runMode } from "../src/core/run";
import { createProvider } from "../src/core/providers";
import type { CompleteRequest, LLMProvider } from "../src/core/providers/types";
import {
  costUSD,
  envKeyFor,
  estimateTokens,
  failedChecks,
  isFatalCallError,
  parseBenchArgs,
  parseModelList,
  parseSamples,
  runChecks,
  summarize,
  toCallError,
  type CallError,
  type CallRecord,
  type ModelSpec,
  type ModelSummary,
  type Price,
  type Sample,
} from "./lib";

const EVAL_DIR = __dirname;
/** Stop a model after this many auth/request errors in a row (they would repeat for every remaining call). */
const MAX_CONSECUTIVE_FATAL = 3;
/** Waits before each retry of a rate-limited (429) call; after the last one the 429 is recorded as an error. */
const RATE_LIMIT_BACKOFF_MS = [3000, 8000, 20000];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ModelResult {
  summary: ModelSummary;
  records: CallRecord[];
  /** Set when the run was stopped early; the reason. */
  aborted?: string;
}
interface Skipped {
  model: string;
  reason: string;
}

/** Wraps a provider to count the characters actually sent (system + user), for the input-token estimate. */
function metered(inner: LLMProvider) {
  const m = { inChars: 0 };
  const provider: LLMProvider = {
    async complete(req: CompleteRequest) {
      m.inChars += req.system.length + req.user.length;
      return inner.complete(req);
    },
  };
  return { provider, m };
}

function fakeProvider(current: { sample?: Sample }): LLMProvider {
  return {
    async complete() {
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
      const s = current.sample;
      return s ? (s.expected ?? s.input) : "";
    },
  };
}

const fmtMs = (n: number) => (Number.isFinite(n) ? `${Math.round(n)} ms` : "n/a");
const fmtCost = (c: number | null) => (c === null ? "n/a" : `$${c.toFixed(6)}`);
const fmtError = (e: CallError) => `${e.kind}${e.status ? ` ${e.status}` : ""}: ${e.message}`;
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

function renderMarkdown(
  stamp: string,
  runs: number,
  results: Record<string, ModelResult>,
  samples: Sample[],
  dryRun: boolean,
  skipped: Skipped[],
): string {
  const L: string[] = [
    `# Bench ${stamp}${dryRun ? " (DRY RUN, fake provider)" : ""}`,
    "",
    `Runs per sample: ${runs}`,
    "",
  ];
  if (skipped.length) {
    L.push("Skipped models (not run):", "");
    for (const k of skipped) L.push(`- ${k.model}: ${k.reason}`);
    L.push("");
  }
  for (const [model, r] of Object.entries(results)) if (r.aborted) L.push(`Aborted early: ${model} (${r.aborted})`, "");
  L.push(
    "Cost is an estimate (characters / 4 tokens, prices from eval/prices.json). Latency includes errored calls.",
    "",
  );
  L.push("| Model | Pass rate | p50 | p95 | p95 (100-word Fix) | Mean cost/call | Errors | Failing checks |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const [model, { summary: s }] of Object.entries(results)) {
    const fails =
      Object.entries(s.checkFailures)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ") || "-";
    const verdict = s.acP95 === null ? "" : s.acP95 < 2000 ? "OK" : "FAIL (AC < 2000 ms)";
    const ac =
      s.acP95 === null ? "n/a" : `${fmtMs(s.acP95)} ${verdict}${s.acReliable ? "" : " (UNRELIABLE: errored calls)"}`;
    L.push(
      `| ${model} | ${(s.passRate * 100).toFixed(0)}% | ${fmtMs(s.p50)} | ${fmtMs(s.p95)} | ${ac} | ${fmtCost(s.meanCostUSD)} | ${s.errors}/${s.calls} (${(s.errorRate * 100).toFixed(0)}%) | ${fails} |`,
    );
  }
  L.push("", "## Outputs for manual review (run 1; failed checks flagged)", "");
  for (const sample of samples) {
    L.push(`### ${sample.id} (${sample.mode}; ${sample.tags.join(", ")})`, "", `Input: \`${esc(sample.input)}\``, "");
    if (sample.expected) L.push(`Expected: \`${esc(sample.expected)}\``, "");
    L.push("| Model | Output | Latency | Failed checks |", "|---|---|---|---|");
    for (const [model, { records }] of Object.entries(results)) {
      const rec = records.find((r) => r.sampleId === sample.id && r.run === 1);
      if (!rec) continue;
      const bad = rec.error
        ? `ERROR ${fmtError(rec.error)}`
        : failedChecks(rec.checks)
            .map((c) => (c.detail ? `${c.name}(${c.detail})` : c.name))
            .join(", ") || "-";
      L.push(`| ${model} | ${esc(rec.output ?? "")} | ${fmtMs(rec.latencyMs)} | ${esc(bad)} |`);
    }
    L.push("");
  }
  return L.join("\n");
}

async function main() {
  const args = parseBenchArgs(process.argv.slice(2), join(EVAL_DIR, "results"));
  const all = parseSamples(readFileSync(join(EVAL_DIR, "samples.jsonl"), "utf8"));
  const samples = args.filter.length
    ? all.filter((s) => args.filter.some((f) => s.id === f || s.tags.includes(f) || s.mode === f))
    : all;
  if (samples.length === 0) throw new Error("No samples selected");
  const prices = JSON.parse(readFileSync(join(EVAL_DIR, "prices.json"), "utf8")) as Record<string, Price>;

  const current: { sample?: Sample } = {};
  const specs: ModelSpec[] = args.dryRun
    ? [{ provider: "openai", model: "fake-dry-run", label: "fake:dry-run" }]
    : parseModelList(args.models);
  if (specs.length === 0) throw new Error("Pass --models <provider:model,...> or --dry-run");

  const acIds = new Set(samples.filter((s) => s.tags.includes("latency-ac")).map((s) => s.id));
  const results: Record<string, ModelResult> = {};
  const skipped: Skipped[] = [];
  const warnedPrices = new Set<string>();

  for (const spec of specs) {
    let base: LLMProvider;
    if (args.dryRun) base = fakeProvider(current);
    else {
      const keyName = envKeyFor(spec);
      const apiKey = process.env[keyName];
      if (!apiKey) {
        console.error(`Skipping ${spec.label}: ${keyName} is not set`);
        skipped.push({ model: spec.label, reason: `${keyName} is not set` });
        continue;
      }
      base = createProvider({ provider: spec.provider, apiKey, baseUrl: spec.baseUrl });
    }
    if (!prices[spec.model] && !warnedPrices.has(spec.model)) {
      warnedPrices.add(spec.model);
      console.error(`Warning: no price for "${spec.model}" in eval/prices.json; its cost will show as n/a`);
    }
    const records: CallRecord[] = [];
    let consecutiveFatal = 0;
    let aborted: string | undefined;
    outer: for (const sample of samples) {
      for (let run = 1; run <= args.runs; run++) {
        if (args.delay > 0) await sleep(args.delay);
        current.sample = sample;
        let output: string | null = null;
        let error: CallError | undefined;
        let latencyMs = 0;
        let m!: ReturnType<typeof metered>["m"];
        // Rate-limited calls are retried with backoff; only the final attempt is recorded, so a 429
        // rejection never shows up as a (fast) latency sample.
        for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFF_MS.length; attempt++) {
          const metering = metered(base);
          m = metering.m;
          output = null;
          error = undefined;
          const t0 = performance.now();
          try {
            output = await runMode(sample.mode, sample.input, {
              provider: metering.provider,
              model: spec.model,
              englishVariant: sample.englishVariant,
              targetLanguage: sample.targetLanguage,
            });
          } catch (e) {
            error = toCallError(e);
          }
          latencyMs = performance.now() - t0;
          if (error?.kind !== "rate_limit" || attempt === RATE_LIMIT_BACKOFF_MS.length) break;
          process.stderr.write("r");
          await sleep(RATE_LIMIT_BACKOFF_MS[attempt]);
        }
        const inputTokens = Math.ceil(m.inChars / 4);
        const outputTokens = output !== null ? estimateTokens(output) : 0;
        const checks =
          output !== null ? runChecks(sample, output) : [{ name: "error", pass: false, detail: fmtError(error!) }];
        records.push({
          sampleId: sample.id,
          mode: sample.mode,
          run,
          latencyMs,
          output,
          error,
          inputTokens,
          outputTokens,
          costUSD: costUSD(inputTokens, outputTokens, prices[spec.model]),
          checks,
          pass: checks.every((c) => c.pass),
        });
        consecutiveFatal = error && isFatalCallError(error) ? consecutiveFatal + 1 : 0;
        if (consecutiveFatal >= MAX_CONSECUTIVE_FATAL) {
          aborted = `${consecutiveFatal} consecutive ${error!.kind} errors: ${error!.message}`;
          console.error(`\nAborting ${spec.label}: ${aborted}`);
          break outer;
        }
      }
      process.stderr.write(".");
    }
    process.stderr.write("\n");
    results[spec.label] = { summary: summarize(records, acIds), records, ...(aborted ? { aborted } : {}) };
  }
  if (Object.keys(results).length === 0) throw new Error("No model could be run (missing API keys?)");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(args.out, { recursive: true });
  const jsonPath = join(args.out, `${stamp}${args.dryRun ? "-dry" : ""}.json`);
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  writeFileSync(jsonPath, JSON.stringify({ stamp, runs: args.runs, dryRun: args.dryRun, skipped, results }, null, 2));
  const md = renderMarkdown(stamp, args.runs, results, samples, args.dryRun, skipped);
  writeFileSync(mdPath, md);
  console.log(md.split("## Outputs")[0]);
  console.log(`Wrote ${jsonPath}\nWrote ${mdPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
