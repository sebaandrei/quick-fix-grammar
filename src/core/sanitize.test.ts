import { describe, expect, it } from "vitest";
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
];

describe("sanitize", () => {
  it.each(cases)("%s", (_name, output, original, expected) => {
    expect(sanitize(output, original)).toBe(expected);
  });
});
