export type BaseUrlProblem = "invalid" | "insecure" | "credentials";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The API key and the text go to this URL, so it must not be cleartext or carry credentials.
 * https is always fine; http is only accepted for the local machine (loopback or *.local).
 */
export function baseUrlProblem(raw: string): BaseUrlProblem | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "invalid";
  if (url.username || url.password) return "credentials";
  if (url.protocol === "https:") return undefined;
  const host = url.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".local") ? undefined : "insecure";
}

export const BASE_URL_PROBLEM_MESSAGES: Record<BaseUrlProblem, string> = {
  invalid: "The Base URL is not a valid http(s) URL.",
  insecure: "The Base URL must use https:// (http:// is only allowed for localhost, 127.0.0.1, [::1] and *.local).",
  credentials: "The Base URL must not contain a username or password.",
};
