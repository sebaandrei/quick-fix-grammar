/**
 * Model benchmark: runs eval/samples.jsonl against candidate models through the real runMode() pipeline.
 *
 *   npx tsx eval/bench.ts --models openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001 --runs 3
 *   npx tsx eval/bench.ts --dry-run          # fake provider, no keys needed
 *
 * Flags: --models <list> (or positional) | --runs N (default 3) | --filter <id-or-tag,...> | --dry-run | --out <dir>
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
  parseModelList,
  parseSamples,
  runChecks,
  summarize,
  type CallRecord,
  type ModelSpec,
  type ModelSummary,
  type Price,
  type Sample,
} from "./lib";

const EVAL_DIR = __dirname;

interface Args {
  models: string;
  runs: number;
  filter: string[];
  dryRun: boolean;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { models: "", runs: 3, filter: [], dryRun: false, out: join(EVAL_DIR, "results") };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--dry-run") a.dryRun = true;
    else if (v === "--models") a.models = argv[++i] ?? "";
    else if (v === "--runs") a.runs = Math.max(1, parseInt(argv[++i] ?? "", 10) || 1);
    else if (v === "--filter") a.filter = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (v === "--out") a.out = argv[++i] ?? a.out;
    else if (!v.startsWith("--")) a.models = v;
    else throw new Error(`Unknown flag ${v}`);
  }
  return a;
}

/** Wraps a provider to count the characters actually sent/received (for token estimation). */
function metered(inner: LLMProvider) {
  const m = { inChars: 0, outChars: 0 };
  const provider: LLMProvider = {
    async complete(req: CompleteRequest) {
      m.inChars += req.system.length + req.user.length;
      const out = await inner.complete(req);
      m.outChars += out.length;
      return out;
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
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

function renderMarkdown(
  stamp: string,
  runs: number,
  results: Record<string, { summary: ModelSummary; records: CallRecord[] }>,
  samples: Sample[],
  dryRun: boolean,
): string {
  const L: string[] = [
    `# Bench ${stamp}${dryRun ? " (DRY RUN, fake provider)" : ""}`,
    "",
    `Runs per sample: ${runs}`,
    "",
  ];
  L.push("| Model | Pass rate | p50 | p95 | p95 (100-word Fix) | Mean cost/call | Errors | Failing checks |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const [model, { summary: s }] of Object.entries(results)) {
    const fails =
      Object.entries(s.checkFailures)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ") || "-";
    const ac = s.acP95 === null ? "n/a" : `${fmtMs(s.acP95)} ${s.acP95 < 2000 ? "OK" : "FAIL (AC < 2000 ms)"}`;
    L.push(
      `| ${model} | ${(s.passRate * 100).toFixed(0)}% | ${fmtMs(s.p50)} | ${fmtMs(s.p95)} | ${ac} | ${fmtCost(s.meanCostUSD)} | ${s.errors}/${s.calls} | ${fails} |`,
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
        ? `ERROR ${rec.error}`
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
  const args = parseArgs(process.argv.slice(2));
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
  const results: Record<string, { summary: ModelSummary; records: CallRecord[] }> = {};

  for (const spec of specs) {
    let base: LLMProvider;
    if (args.dryRun) base = fakeProvider(current);
    else {
      const keyName = envKeyFor(spec);
      const apiKey = process.env[keyName];
      if (!apiKey) {
        console.error(`Skipping ${spec.label}: ${keyName} is not set`);
        continue;
      }
      base = createProvider({ provider: spec.provider, apiKey, baseUrl: spec.baseUrl });
    }
    const records: CallRecord[] = [];
    for (const sample of samples) {
      for (let run = 1; run <= args.runs; run++) {
        const { provider, m } = metered(base);
        current.sample = sample;
        const t0 = performance.now();
        let output: string | null = null;
        let error: string | undefined;
        try {
          output = await runMode(sample.mode, sample.input, {
            provider,
            model: spec.model,
            englishVariant: sample.englishVariant,
            targetLanguage: sample.targetLanguage,
          });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        const latencyMs = performance.now() - t0;
        const inputTokens = Math.ceil(m.inChars / 4);
        const outputTokens = output !== null ? estimateTokens(output) : 0;
        const checks = output !== null ? runChecks(sample, output) : [{ name: "error", pass: false, detail: error }];
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
      }
      process.stderr.write(".");
    }
    process.stderr.write("\n");
    results[spec.label] = { summary: summarize(records, acIds), records };
  }
  if (Object.keys(results).length === 0) throw new Error("No model could be run (missing API keys?)");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(args.out, { recursive: true });
  const jsonPath = join(args.out, `${stamp}${args.dryRun ? "-dry" : ""}.json`);
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  writeFileSync(jsonPath, JSON.stringify({ stamp, runs: args.runs, dryRun: args.dryRun, results }, null, 2));
  const md = renderMarkdown(stamp, args.runs, results, samples, args.dryRun);
  writeFileSync(mdPath, md);
  console.log(md.split("## Outputs")[0]);
  console.log(`Wrote ${jsonPath}\nWrote ${mdPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
