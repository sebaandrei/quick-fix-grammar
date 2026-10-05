import { ProviderError } from "./types";

export const REQUEST_TIMEOUT_MS = 10_000;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

const MAX_DETAIL_CHARS = 300;

/** Map a non-2xx HTTP status to a ProviderError. Detail is truncated to 300 chars. */
export function errorForStatus(status: number, detail: string): ProviderError {
  const d = detail.slice(0, MAX_DETAIL_CHARS).trim();
  if (status === 401 || status === 403)
    return new ProviderError("auth", `Authentication failed (${status}). ${d}`.trim(), status);
  if (status === 429) return new ProviderError("rate_limit", `Rate limited (429). ${d}`.trim(), status);
  if (status === 400 || status === 404 || status === 422)
    return new ProviderError("request", `Request rejected by the provider (${status}). ${d}`.trim(), status);
  return new ProviderError("bad_response", `Request failed with status ${status}. ${d}`.trim(), status);
}

function abortError(timedOut: boolean, cause: unknown): ProviderError {
  return timedOut
    ? new ProviderError("timeout", "Request timed out.", undefined, { cause })
    : new ProviderError("aborted", "Request was aborted.", undefined, { cause });
}

/**
 * POST JSON with a timeout combined with an optional caller signal.
 * Throws ProviderError (timeout / aborted / network / auth / rate_limit / request / bad_response).
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
        throw abortError(timedOut, e);
      }
      throw new ProviderError("network", `Network error: ${e instanceof Error ? e.message : String(e)}`, undefined, {
        cause: e,
      });
    }

    if (!res.ok) {
      let detail: string;
      try {
        detail = (await res.text()).slice(0, MAX_DETAIL_CHARS);
      } catch {
        detail = "(could not read response body)";
      }
      throw errorForStatus(res.status, detail);
    }

    try {
      return await res.json();
    } catch (e) {
      if (controller.signal.aborted) throw abortError(timedOut, e);
      throw new ProviderError("bad_response", "Response body was not valid JSON.", res.status, { cause: e });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
