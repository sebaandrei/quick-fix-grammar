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

// Characters a text rewrite never needs but a hostile or confused model could use to hide or reorder text
// (ESC and other C0 controls, bidi overrides, zero-width and word-joiner characters, Unicode tag characters).
// ZWJ/ZWNJ (U+200D/U+200C) are left alone: emoji sequences and Persian/Indic text need them.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const INVISIBLE_CHARS = /[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;

function withoutClass(text: string, cls: RegExp): string {
  return text.replace(new RegExp(cls.source, `${cls.flags}g`), "");
}

/** Removes each class of unexpected characters unless the original text itself contained that class. */
function stripInvisible(out: string, original: string): string {
  let result = out;
  for (const cls of [CONTROL_CHARS, INVISIBLE_CHARS]) {
    if (!cls.test(original)) result = withoutClass(result, cls);
  }
  return result;
}

const INPUT_TAG_OPEN = /^<input_text(?:_[0-9a-f]{8})?>\s*/i;
// No leading \s*: an unanchored whitespace prefix makes this quadratic on long whitespace runs; trim() handles it.
const INPUT_TAG_CLOSE = /<\/input_text(?:_[0-9a-f]{8})?>$/i;

/**
 * Small models sometimes echo the wrapper tags. The per-call tag name never occurs in the original
 * (inputTagFor guarantees it), so any leading/trailing input_text tag is ours, unless the original
 * itself mentions input_text.
 */
function stripInputTags(out: string, original: string): string {
  if (/input_text/i.test(original)) return out;
  return out.replace(INPUT_TAG_OPEN, "").replace(INPUT_TAG_CLOSE, "");
}

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
 * Clean model output: strip control/invisible characters, echoed input tags, preambles, code fences and wrapping quotes the input
 * didn't have, and re-apply the original's leading/trailing whitespace.
 */
export function sanitize(output: string, original: string, opts?: { mode?: ModeId }): string {
  const lead = /^\s*/.exec(original)?.[0] ?? "";
  const trail = original.length > lead.length ? (/\s*$/.exec(original)?.[0] ?? "") : "";

  let out = stripInvisible(output, original).trim();
  out = stripInputTags(out, original).trim();
  out = stripPreamble(out, original, opts?.mode).trim();
  out = stripFences(out, original).trim();
  out = stripQuotes(out, original).trim();
  return lead + out + trail;
}
