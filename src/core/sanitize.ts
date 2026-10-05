import type { ModeId } from "./modes";

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
];

const PREAMBLE_OPENER = /^(?:here(?:'s|s| is| are)|sure|certainly|of course|okay|ok|below is|this is)\b/i;
const PREAMBLE = /^(?:here(?:'s| is| are)|sure|certainly|of course|okay|ok|below is|this is)\b[^\n]*:[ \t]*(?:\r?\n)+/i;

/** Elisions ('Twas, '90s, 'em) start with an apostrophe, not an opening quote. */
const ELISION = /^(?:\d\d|tis\b|twas\b|twere\b|em\b|cause\b|round\b)/i;

function stripPreamble(out: string, original: string, mode?: ModeId): string {
  // Translate output is a different text, so a leading "Here is ...:" may be real content.
  if (mode === "translate") return out;
  const m = PREAMBLE.exec(out);
  if (!m) return out;
  const firstLine = original.trimStart().split(/\r?\n/, 1)[0].trimEnd();
  if (firstLine.endsWith(":") || PREAMBLE_OPENER.test(firstLine)) return out;
  return out.slice(m[0].length);
}

function stripFences(out: string, original: string): string {
  if (original.includes("```")) return out;
  const m = /^```[^\n`]*\r?\n([\s\S]*?)\r?\n?```$/.exec(out);
  return m ? m[1] : out;
}

function stripQuotes(out: string, original: string): string {
  const o = original.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (out.length >= open.length + close.length && out.startsWith(open) && out.endsWith(close)) {
      // Original was itself wrapped in the same quotes: keep.
      if (o.startsWith(open) && o.endsWith(close)) return out;
      const inner = out.slice(open.length, out.length - close.length);
      // Internal quotes mean separate pairs ("a" and "b") rather than one wrapper.
      if (inner.includes(open) || inner.includes(close)) return out;
      if ((open === "'" || open === "‘") && ELISION.test(inner)) return out;
      return inner;
    }
  }
  return out;
}

/**
 * Clean model output: strip preambles, code fences and wrapping quotes the input
 * didn't have, and re-apply the original's leading/trailing whitespace.
 */
export function sanitize(output: string, original: string, opts?: { mode?: ModeId }): string {
  const lead = /^\s*/.exec(original)?.[0] ?? "";
  const trail = original.length > lead.length ? (/\s*$/.exec(original)?.[0] ?? "") : "";

  let out = output.trim();
  out = stripPreamble(out, original, opts?.mode).trim();
  out = stripFences(out, original).trim();
  out = stripQuotes(out, original).trim();
  return lead + out + trail;
}
