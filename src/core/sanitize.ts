const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
];

const PREAMBLE = /^(?:here(?:'s| is| are)|sure|certainly|of course|okay|ok|below is|this is)\b[^\n]*:[ \t]*(?:\r?\n)+/i;

function stripPreamble(out: string, original: string): string {
  const m = PREAMBLE.exec(out);
  if (!m) return out;
  if (PREAMBLE.test(original.trimStart())) return out;
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
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      // Original was itself wrapped in the same quotes: keep.
      if (o.startsWith(open) && o.endsWith(close)) return out;
      const inner = out.slice(open.length, out.length - close.length);
      // Avoid stripping when quotes are internal pairs, e.g. "a" and "b".
      if (open === close && inner.includes(open)) return out;
      return inner;
    }
  }
  return out;
}

/**
 * Clean model output: strip preambles, code fences and wrapping quotes the input
 * didn't have, and re-apply the original's leading/trailing whitespace.
 */
export function sanitize(output: string, original: string): string {
  const lead = /^\s*/.exec(original)?.[0] ?? "";
  const trail = original.length > lead.length ? (/\s*$/.exec(original)?.[0] ?? "") : "";

  let out = output.trim();
  out = stripPreamble(out, original).trim();
  out = stripFences(out, original).trim();
  out = stripQuotes(out, original).trim();
  return lead + out + trail;
}
