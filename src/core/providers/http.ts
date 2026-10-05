import { ProviderError } from "./types";

export const REQUEST_TIMEOUT_MS = 10_000;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Map an HTTP status to a ProviderError; returns undefined for 2xx. */
export function errorForStatus(status: number, detail: string): ProviderError | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 401 || status === 403)
    return new ProviderError("auth", `Authentication failed (${status}). ${detail}`.trim(), status);
  if (status === 429) return new ProviderError("rate_limit", `Rate limited (429). ${detail}`.trim(), status);
  return new ProviderError("bad_response", `Request failed with status ${status}. ${detail}`.trim(), status);
}

/**
 * POST JSON with a timeout combined with an optional caller signal.
 * Throws ProviderError (timeout / network / auth / rate_limit / bad_response).
 * Returns the parsed JSON body.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        throw new ProviderError("timeout", timedOut ? "Request timed out." : "Request was aborted.");
      }
      throw new ProviderError("network", `Network error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        // ignore
      }
      throw errorForStatus(res.status, detail) as ProviderError;
    }

    try {
      return await res.json();
    } catch {
      if (controller.signal.aborted) {
        throw new ProviderError("timeout", timedOut ? "Request timed out." : "Request was aborted.");
      }
      throw new ProviderError("bad_response", "Response body was not valid JSON.", res.status);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
