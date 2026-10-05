import { describe, expect, it } from "vitest";
import type { ModeId } from "./modes";
import { sanitize } from "./sanitize";

const cases: [string, string, string, string][] = [
  ["plain passthrough", "Hello world.", "hello world", "Hello world."],
  ["double quotes", '"Hello world."', "hello world", "Hello world."],
  ["curly quotes", "“Hello world.”", "hello world", "Hello world."],
  ["keeps quotes if input had them", '"Hi," she said.', '"hi" she said', '"Hi," she said.'],
  ["keeps wrapping quotes if original wrapped", '"Hello."', '"hello"', '"Hello."'],
  ["internal quote pairs kept", '"a" and "b"', "a and b", '"a" and "b"'],
  ["preamble", "Here is the corrected text:\n\nHello world.", "hello world", "Hello world."],
  ["preamble Here's", "Here's the fixed version:\nHello world.", "hello world", "Hello world."],
  ["Sure preamble", "Sure! Here is your text:\n\nHello.", "hello", "Hello."],
  ["preamble kept if input had one", "Here is the thing:\nx", "Here is the thing:\ny", "Here is the thing:\nx"],
  ["code fence", "```\nHello world.\n```", "hello world", "Hello world."],
  ["code fence with lang", "```text\nHello\nworld\n```", "hello world", "Hello\nworld"],
  ["fence kept if input had one", "```js\nconst a = 1;\n```", "```js\nconst a=1\n```", "```js\nconst a = 1;\n```"],
  ["preamble + fence + quotes", 'Here is the result:\n\n```\n"Hi there"\n```', "hi there", "Hi there"],
  ["preserve leading ws", "Hello.", "  hello", "  Hello."],
  ["preserve trailing newline", "Hello.\n", "hello\n", "Hello.\n"],
  ["restores trailing newline model dropped", "Hello.", "hello\n\n", "Hello.\n\n"],
  ["drops extra trailing newline model added", "Hello.\n\n", "hello", "Hello."],
  ["both ends", "Hello.", "\n  hello \t\n", "\n  Hello.\t\n".replace("\t", " \t")],
  ["multi-line markdown kept", "- a\n- b\n\n**c**", "- a\n- b\n\n**c**", "- a\n- b\n\n**c**"],
  ["single char", "A", "a", "A"],
  // curly / guillemet / single-curly: inner-pair guard on every pair
  ["curly pairs kept", "“Yes” and “no”", "yes and no", "“Yes” and “no”"],
  ["guillemet pairs kept", "«Da» și «nu»", "da si nu", "«Da» și «nu»"],
  ["single curly pairs kept", "‘Yes’ and ‘no’", "yes and no", "‘Yes’ and ‘no’"],
  ["guillemet wrapper stripped", "«Hello world.»", "hello world", "Hello world."],
  ["single curly wrapper stripped", "‘Hello world.’", "hello world", "Hello world."],
  ["backtick wrapper stripped", "`Hello world.`", "hello world", "Hello world."],
  ["backtick pairs kept", "`a` and `b`", "a and b", "`a` and `b`"],
  ["elision 'Twas not mangled", "'Twas the night before", "twas the night before", "'Twas the night before"],
  ["elision 'Twas wrapped sentence kept", "'Twas brillig'", "twas brillig", "'Twas brillig'"],
  ["elision ’90s not mangled", "I love the ’90s", "i love the 90s", "I love the ’90s"],
  ["elision 90s straight kept", "'90s kids rule'", "90s kids rule", "'90s kids rule'"],
  ["apostrophe inside wrapper kept", "'It's fine'", "its fine", "'It's fine'"],
  ["lone quote char", '"', "x", '"'],
  // preamble must not delete real content
  [
    "input intro line with colon kept",
    "Here's what I need:\n- a\n- b",
    "Heres what i need:\n- a\n- b",
    "Here's what I need:\n- a\n- b",
  ],
  [
    "input opener without colon kept",
    "Here is what I need:\n- a",
    "Here is what i need\n- a",
    "Here is what I need:\n- a",
  ],
  ["input first line ends with colon kept", "Sure thing:\nx", "sure thing:\ny", "Sure thing:\nx"],
  ["indented first line ending with colon", "Okay, plan:\nx", "  okay plan:\ny", "  Okay, plan:\nx"],
  ["unrelated input still strips", "Here is the fix:\n\nFine.", "fine\nsecond", "Fine."],
];

const modeCases: [string, ModeId | undefined, string, string, string][] = [
  [
    "translate keeps RO->EN header",
    "translate",
    "Here is the list:\n- a\n- b",
    "Aici este lista:\n- a\n- b",
    "Here is the list:\n- a\n- b",
  ],
  ["fix-only still strips", "fix-only", "Here is the list:\n- a", "lst\n- a", "- a"],
  ["no mode still strips", undefined, "Here is the list:\n- a", "lst\n- a", "- a"],
  ["translate still strips fences", "translate", "```\nHello\n```", "Salut", "Hello"],
];

describe("sanitize", () => {
  it.each(cases)("%s", (_name, output, original, expected) => {
    expect(sanitize(output, original)).toBe(expected);
  });
});

const tagCases: [string, string, string, string][] = [
  ["echoed tags", "<input_text_ab12cd34>\nHello world.\n</input_text_ab12cd34>", "hello world", "Hello world."],
  ["echoed untagged names", "<input_text>Hello world.</input_text>", "hello world", "Hello world."],
  ["only closing tag echoed", "Hello world.\n</input_text_ab12cd34>", "hello world", "Hello world."],
  ["only opening tag echoed", "<input_text_ab12cd34>\nHello world.", "hello world", "Hello world."],
  ["tags then quotes", '<input_text_ab12cd34>\n"Hello world."\n</input_text_ab12cd34>', "hello world", "Hello world."],
  ["case-insensitive", "<INPUT_TEXT_AB12CD34>Hi</INPUT_TEXT_AB12CD34>", "hi", "Hi"],
  [
    "kept when the original discusses input_text",
    "<input_text>Hi</input_text>",
    "wrap it in <input_text> tags",
    "<input_text>Hi</input_text>",
  ],
  ["unrelated tags kept", "<b>Hello</b>", "hello", "<b>Hello</b>"],
  ["tag in the middle kept", "a </input_text_ab12cd34> b", "a b", "a </input_text_ab12cd34> b"],
];

describe("sanitize echoed input tags", () => {
  it.each(tagCases)("%s", (_name, output, original, expected) => {
    expect(sanitize(output, original)).toBe(expected);
  });
});

describe("sanitize with mode", () => {
  it.each(modeCases)("%s", (_name, mode, output, original, expected) => {
    expect(sanitize(output, original, { mode })).toBe(expected);
  });
});
