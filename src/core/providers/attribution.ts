/**
 * App attribution for OpenRouter, so spending shows up under this app's name instead of "Unknown".
 * Sent only to openrouter.ai and its subdomains (never to other hosts) and carries no user text.
 * `hidden` keeps a newly created app out of OpenRouter's public rankings and marketplace; drop it
 * if the project should be listed publicly.
 */
export const APP_URL = "https://github.com/sebaandrei/quick-fix-grammar";
export const APP_TITLE = "Quick Fix Grammar";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function isOpenRouterUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

export function attributionHeaders(baseUrl: string): Record<string, string> {
  if (!isOpenRouterUrl(baseUrl)) return {};
  return {
    "HTTP-Referer": APP_URL,
    "X-OpenRouter-Title": APP_TITLE,
    "X-OpenRouter-App-Visibility": "hidden",
  };
}
