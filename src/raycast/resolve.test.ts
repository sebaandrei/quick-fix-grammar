import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { PROVIDER_IDS } from "../core/providers/types";

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
    expect(buildConfig({ ...base, provider: "openrouter", baseUrl: "https://x/v1" }).baseUrl).toBeUndefined();
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
  it("openrouter provider defaults to Gemini 3.1 Flash-Lite and ignores base URL", () => {
    expect(modelFor({ provider: "openrouter" })).toBe("google/gemini-3.1-flash-lite");
    expect(modelFor({ provider: "openrouter", baseUrl: "https://evil.example/v1" })).toBe(GEMINI_OPENROUTER_MODEL);
    expect(modelFor({ provider: "openrouter", defaultModel: "mistralai/ministral-14b-2512" })).toBe(
      "mistralai/ministral-14b-2512",
    );
    expect(modelFor({ provider: "openrouter", model: "x/y", defaultModel: "a/b" })).toBe("x/y");
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

  it("rejects an unknown provider value (stale preference)", () => {
    const cfg = { ...buildConfig(base), provider: "removed-provider" as never };
    expect(kindOf(() => validateConfig(cfg))).toBe("unknown_provider");
  });
  it("accepts openrouter, openai and anthropic with just a key", () => {
    expect(kindOf(() => validateConfig(buildConfig({ ...base, provider: "openrouter" })))).toBeUndefined();
    expect(kindOf(() => validateConfig(buildConfig(base)))).toBeUndefined();
    expect(kindOf(() => validateConfig(buildConfig({ ...base, provider: "anthropic" })))).toBeUndefined();
  });
  it("requires a non-blank api key", () => {
    expect(kindOf(() => validateConfig(buildConfig({ ...base, apiKey: "   " })))).toBe("missing_api_key");
    expect(kindOf(() => validateConfig(buildConfig({ provider: "openai" })))).toBe("missing_api_key");
  });
  it("openai-compatible rejects an unsafe base URL", () => {
    for (const baseUrl of ["http://api.openai.com/v1", "http://192.168.1.5/v1", "https://u:p@x.example/v1", "nope"]) {
      const c = buildConfig({ ...base, provider: "openai-compatible", baseUrl });
      expect(kindOf(() => validateConfig(c, "m"))).toBe("bad_base_url");
    }
    for (const baseUrl of ["https://x.example/v1", "http://localhost:11434/v1", "http://[::1]:8000/v1"]) {
      const c = buildConfig({ ...base, provider: "openai-compatible", baseUrl });
      expect(kindOf(() => validateConfig(c, "m"))).toBeUndefined();
    }
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

describe("modelFor feeds validateConfig", () => {
  const resolve = (prefs: RawPreferences & { model?: string }) => {
    const cfg = buildConfig(prefs);
    validateConfig(cfg, modelFor({ ...prefs, baseUrl: cfg.baseUrl }));
  };
  it("openai-compatible on OpenRouter or Google needs no model, on a local host it does", () => {
    const compat = { provider: "openai-compatible", apiKey: "k" } as const;
    expect(() => resolve({ ...compat, baseUrl: "https://openrouter.ai/api/v1" })).not.toThrow();
    expect(() =>
      resolve({ ...compat, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" }),
    ).not.toThrow();
    expect(() => resolve({ ...compat, baseUrl: "http://localhost:11434/v1" })).toThrow(/Default Model/);
    expect(() => resolve({ ...compat, baseUrl: "http://localhost:11434/v1", defaultModel: "llama3" })).not.toThrow();
  });
  it("openrouter, openai and anthropic need only a key", () => {
    for (const provider of ["openrouter", "openai", "anthropic"] as const) {
      expect(() => resolve({ provider, apiKey: "k" })).not.toThrow();
    }
  });
});

describe("manifest", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    preferences: { name: string; default?: string; data?: { value: string }[] }[];
  };
  it("provider dropdown matches PROVIDER_IDS and defaults to openrouter", () => {
    const provider = manifest.preferences.find((p) => p.name === "provider");
    expect(provider?.data?.map((d) => d.value).sort()).toEqual([...PROVIDER_IDS].sort());
    expect(provider?.default).toBe("openrouter");
  });
  it("every command has a source file and only reads preferences the code knows", () => {
    const withCommands = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      commands: { name: string; preferences?: { name: string }[] }[];
    };
    for (const c of withCommands.commands) {
      expect(() => readFileSync(join(process.cwd(), "src", `${c.name}.tsx`), "utf8")).not.toThrow();
      for (const p of c.preferences ?? []) expect(["model", "targetLanguage"]).toContain(p.name);
    }
  });
  it("level and englishVariant dropdowns offer exactly what buildConfig accepts", () => {
    const values = (name: string) =>
      manifest.preferences
        .find((p) => p.name === name)
        ?.data?.map((d) => d.value)
        .sort();
    expect(values("level")).toEqual(["fix-improve", "fix-only"]);
    expect(values("englishVariant")).toEqual(["uk", "us"]);
  });
});
