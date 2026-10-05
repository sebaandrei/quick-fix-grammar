import { describe, expect, it } from "vitest";
import { APP_TITLE, APP_URL, OPENROUTER_BASE_URL, attributionHeaders, isOpenRouterUrl } from "./attribution";

describe("isOpenRouterUrl", () => {
  it.each([
    "https://openrouter.ai/api/v1",
    " https://OpenRouter.ai/api/v1/ ",
    "https://eu.openrouter.ai/api/v1",
    "http://openrouter.ai:443/api/v1",
    OPENROUTER_BASE_URL,
  ])("accepts %s", (url) => {
    expect(isOpenRouterUrl(url)).toBe(true);
  });

  it.each([
    "https://openrouter.ai.evil.com/api/v1",
    "https://evil.com/openrouter.ai",
    "https://openrouter.ai@evil.com/v1",
    "https://notopenrouter.ai/v1",
    "https://api.openai.com/v1",
    "http://localhost:11434/v1",
    "openrouter.ai/api/v1",
    "",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isOpenRouterUrl(url)).toBe(false);
  });
});

describe("attributionHeaders", () => {
  it("sends the app headers to OpenRouter only", () => {
    expect(attributionHeaders(OPENROUTER_BASE_URL)).toEqual({
      "HTTP-Referer": APP_URL,
      "X-OpenRouter-Title": APP_TITLE,
      "X-OpenRouter-App-Visibility": "hidden",
    });
    expect(attributionHeaders("https://api.openai.com/v1")).toEqual({});
  });
});
