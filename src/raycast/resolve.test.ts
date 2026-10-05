import { describe, expect, it } from "vitest";

import { ConfigError } from "./errors";
import {
  ANTHROPIC_DEFAULT_MODEL,
  buildConfig,
  GEMINI_OPENROUTER_MODEL,
  levelToMode,
  modelFor,
  targetLanguageFor,
  validateConfig,
  type RawPreferences,
} from "./resolve";

const base: RawPreferences = { provider: "openai", apiKey: "sk-test" };

describe("buildConfig", () => {
  it("trims the api key and applies defaults", () => {
    expect(buildConfig({ ...base, apiKey: "  sk-1  " })).toEqual({
      provider: "openai",
      apiKey: "sk-1",
      baseUrl: undefined,
      defaultModel: undefined,
      level: "fix-improve",
      englishVariant: "us",
    });
  });
  it("treats empty-string prefs as unset", () => {
    const c = buildConfig({ ...base, defaultModel: "  ", level: "", englishVariant: "" });
    expect(c.defaultModel).toBeUndefined();
    expect(c.level).toBe("fix-improve");
    expect(c.englishVariant).toBe("us");
  });
  it("honors level and variant", () => {
    const c = buildConfig({ ...base, level: "fix-only", englishVariant: "uk" });
    expect(c.level).toBe("fix-only");
    expect(c.englishVariant).toBe("uk");
  });
  it("uses baseUrl only for openai-compatible", () => {
    expect(buildConfig({ ...base, baseUrl: "https://x/v1" }).baseUrl).toBeUndefined();
    expect(buildConfig({ ...base, provider: "anthropic", baseUrl: "https://x/v1" }).baseUrl).toBeUndefined();
    expect(buildConfig({ ...base, provider: "openai-compatible", baseUrl: " https://x/v1 " }).baseUrl).toBe(
      "https://x/v1",
    );
  });
  it("missing apiKey becomes empty string", () => {
    expect(buildConfig({ provider: "openai" }).apiKey).toBe("");
  });
});

describe("modelFor", () => {
  it("command override wins", () => {
    expect(modelFor({ provider: "openai", model: "a", defaultModel: "b" })).toBe("a");
    expect(modelFor({ provider: "anthropic", model: " a ", defaultModel: "b" })).toBe("a");
  });
  it("blank override falls to default model", () => {
    expect(modelFor({ provider: "openai", model: "  ", defaultModel: "b" })).toBe("b");
    expect(modelFor({ provider: "openai", model: "", defaultModel: " b " })).toBe("b");
  });
  it("openai with nothing leaves undefined (core default)", () => {
    expect(modelFor({ provider: "openai" })).toBeUndefined();
    expect(modelFor({ provider: "openai-compatible", model: "", defaultModel: "" })).toBeUndefined();
  });
  it("anthropic falls back to haiku", () => {
    expect(modelFor({ provider: "anthropic" })).toBe(ANTHROPIC_DEFAULT_MODEL);
    expect(modelFor({ provider: "anthropic", model: "", defaultModel: "" })).toBe("claude-haiku-4-5-20251001");
  });
  it("anthropic default model beats fallback", () => {
    expect(modelFor({ provider: "anthropic", defaultModel: "claude-x" })).toBe("claude-x");
  });
  it("openai-compatible falls back to Gemini 3.1 Flash-Lite on OpenRouter and Google hosts", () => {
    const p = "openai-compatible";
    expect(modelFor({ provider: p, baseUrl: "https://openrouter.ai/api/v1" })).toBe("google/gemini-3.1-flash-lite");
    expect(modelFor({ provider: p, baseUrl: " https://OpenRouter.ai/api/v1/ " })).toBe(GEMINI_OPENROUTER_MODEL);
    expect(modelFor({ provider: p, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" })).toBe(
      "gemini-3.1-flash-lite",
    );
  });
  it("openai-compatible has no fallback for other hosts, and an explicit model always wins", () => {
    const p = "openai-compatible";
    for (const baseUrl of ["http://localhost:11434/v1", "https://evil.example/openrouter.ai/v1", "not a url", ""]) {
      expect(modelFor({ provider: p, baseUrl })).toBeUndefined();
    }
    expect(modelFor({ provider: p, baseUrl: "https://openrouter.ai/api/v1", defaultModel: "x/y" })).toBe("x/y");
    expect(modelFor({ provider: p, baseUrl: "https://openrouter.ai/api/v1", model: "m", defaultModel: "x/y" })).toBe(
      "m",
    );
  });
  it("the host fallback does not apply to other providers", () => {
    expect(modelFor({ provider: "openai", baseUrl: "https://openrouter.ai/api/v1" })).toBeUndefined();
  });
});

describe("targetLanguageFor", () => {
  it("trims and blanks to undefined", () => {
    expect(targetLanguageFor({ targetLanguage: " German " })).toBe("German");
    expect(targetLanguageFor({ targetLanguage: "  " })).toBeUndefined();
    expect(targetLanguageFor({})).toBeUndefined();
  });
});

describe("validateConfig", () => {
  const kindOf = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      return (e as ConfigError).kind;
    }
    return undefined;
  };

  it("accepts openai and anthropic with a key", () => {
    expect(kindOf(() => validateConfig(buildConfig(base)))).toBeUndefined();
    expect(kindOf(() => validateConfig(buildConfig({ ...base, provider: "anthropic" })))).toBeUndefined();
  });
  it("requires a non-blank api key", () => {
    expect(kindOf(() => validateConfig(buildConfig({ ...base, apiKey: "   " })))).toBe("missing_api_key");
    expect(kindOf(() => validateConfig(buildConfig({ provider: "openai" })))).toBe("missing_api_key");
  });
  it("openai-compatible requires baseUrl then model", () => {
    const c = buildConfig({ ...base, provider: "openai-compatible" });
    expect(kindOf(() => validateConfig(c, "m"))).toBe("missing_base_url");
    const withUrl = buildConfig({ ...base, provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" });
    expect(kindOf(() => validateConfig(withUrl))).toBe("missing_model");
    expect(kindOf(() => validateConfig(withUrl, "  "))).toBe("missing_model");
    expect(kindOf(() => validateConfig(withUrl, "llama3"))).toBeUndefined();
  });
  it("a baseUrl pref is ignored for openai so it cannot satisfy anything", () => {
    const c = buildConfig({ ...base, baseUrl: "https://evil/v1" });
    expect(c.baseUrl).toBeUndefined();
  });
});

describe("levelToMode", () => {
  it("maps levels", () => {
    expect(levelToMode("fix-only")).toBe("fix-only");
    expect(levelToMode("fix-improve")).toBe("fix-improve");
    expect(levelToMode(undefined)).toBe("fix-improve");
  });
});
