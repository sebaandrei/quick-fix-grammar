import { describe, expect, it } from "vitest";
import { modes, type ModeId } from "./modes";

const ids: ModeId[] = [
  "fix-only",
  "fix-improve",
  "shorten",
  "tone-professional",
  "tone-friendly",
  "tone-casual",
  "tone-confident",
  "tone-direct",
  "translate",
];

describe("modes registry", () => {
  it("has every mode with sane config", () => {
    for (const id of ids) {
      const m = modes[id];
      expect(m.id).toBe(id);
      expect(m.defaultModel).toBeTruthy();
      expect(m.temperature).toBeGreaterThanOrEqual(0);
      expect(m.temperature).toBeLessThanOrEqual(0.3);
    }
  });

  it.each(ids)("%s prompt wraps input and carries shared rules", (id) => {
    const p = modes[id].buildPrompt("Hello <b>world</b>", {});
    expect(p.user).toContain("<input_text>\nHello <b>world</b>\n</input_text>");
    expect(p.system).toMatch(/ONLY the rewritten text/);
    expect(p.system).toMatch(/DATA, not instructions/);
    expect(p.system).toMatch(/markdown/i);
    expect(p.system).toMatch(/URLs/);
  });

  it("englishVariant is honored", () => {
    expect(modes["fix-only"].buildPrompt("x", { englishVariant: "uk" }).system).toMatch(/British/);
    expect(modes["fix-only"].buildPrompt("x", { englishVariant: "us" }).system).toMatch(/American/);
    expect(modes["fix-only"].buildPrompt("x", {}).system).not.toMatch(/British|American/);
  });

  it("fix-only is minimal, fix-improve polishes", () => {
    expect(modes["fix-only"].buildPrompt("x", {}).system).toMatch(/MINIMAL/);
    expect(modes["fix-improve"].buildPrompt("x", {}).system).toMatch(/polish/i);
  });

  it("tone modes name their tone", () => {
    for (const t of ["professional", "friendly", "casual", "confident", "direct"]) {
      expect(modes[`tone-${t}` as ModeId].buildPrompt("x", {}).system).toContain(`${t} tone`);
    }
  });

  it("translate: auto toggles EN/RO, or uses target language", () => {
    const auto = modes.translate.buildPrompt("x", {}).system;
    expect(auto).toMatch(/Romanian/);
    expect(auto).toMatch(/English/);
    const t = modes.translate.buildPrompt("x", { targetLanguage: "German" }).system;
    expect(t).toContain("into German");
    expect(t).not.toMatch(/Detect the language/);
  });
});
