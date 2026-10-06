import { ProviderError } from "./types";

export const REQUEST_TIMEOUT_MS = 10_000;
/** Pause before the single retry of a transient failure. */
export const RETRY_DELAY_MS = 300;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

const MAX_DETAIL_CHARS = 300;
/** Legitimate answers are tens of KB at most (output tokens are capped); anything near this is a misbehaving host. */
export const MAX_RESPONSE_BYTES = 1_000_000;

function tooLarge(status: number): ProviderError {
  return new ProviderError("bad_response", "The response was unexpectedly large and was discarded.", status);
}

/** Reads the body as text, giving up (and cancelling the stream) once it exceeds maxBytes. */
export async function readTextCapped(res: Response, maxBytes: number = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge(res.status);
  }
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(res.status);
    }
    chunks.push(value);
  }
  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
}

/** Map a non-2xx HTTP status to a ProviderError. Detail is truncated to 300 chars. */
export function errorForStatus(status: number, detail: string): ProviderError {
  const d = detail.slice(0, MAX_DETAIL_CHARS).trim();
  const retryable = status === 408 || status === 429 || (status >= 500 && status < 600);
  if (status === 401 || status === 403)
    return new ProviderError("auth", `Authentication failed (${status}). ${d}`.trim(), status);
  if (status === 402) return new ProviderError("billing", `Payment required (402). ${d}`.trim(), status);
  if (status === 408)
    return new ProviderError("timeout", `Request timed out (408). ${d}`.trim(), status, { retryable });
  if (status === 429) return new ProviderError("rate_limit", `Rate limited (429). ${d}`.trim(), status, { retryable });
  if (status === 400 || status === 404 || status === 422)
    return new ProviderError("request", `Request rejected by the provider (${status}). ${d}`.trim(), status);
  return new ProviderError("bad_response", `Request failed with status ${status}. ${d}`.trim(), status, { retryable });
}

/** undici reports `redirect: "error"` as a TypeError ("fetch failed") whose cause says "unexpected redirect". */
function isRedirectError(e: unknown): boolean {
  const text = (err: unknown) => (err instanceof Error ? err.message : String(err));
  return /redirect/i.test(text(e)) || (e instanceof Error && /redirect/i.test(text(e.cause)));
}

function abortError(timedOut: boolean, cause: unknown): ProviderError {
  return timedOut
    ? new ProviderError("timeout", "Request timed out.", undefined, { cause })
    : new ProviderError("aborted", "Request was aborted.", undefined, { cause });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * POST JSON with a timeout combined with an optional caller signal. A transient failure (network error, 408, 429,
 * 5xx) is retried once after a short pause; both attempts share one deadline of `timeoutMs`, so the caller never
 * waits longer. `check` inspects each parsed body and may throw a ProviderError (e.g. an error object sent with
 * HTTP 200); a retryable one is retried like an HTTP failure.
 * Throws ProviderError (timeout / aborted / network / auth / billing / rate_limit / request / bad_response).
 * Returns the parsed JSON body.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  check?: (json: unknown) => void,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const attempt = async (budgetMs: number) => {
    const json = await postJsonOnce(url, headers, body, signal, budgetMs);
    check?.(json);
    return json;
  };
  try {
    return await attempt(timeoutMs);
  } catch (e) {
    if (!(e instanceof ProviderError) || !e.retryable || signal?.aborted) throw e;
    if (deadline - Date.now() - RETRY_DELAY_MS <= 0) throw e;
    await sleep(RETRY_DELAY_MS, signal);
    // Recomputed after the pause: a stalled event loop or a sleeping Mac must not extend the deadline.
    const remaining = deadline - Date.now();
    if (signal?.aborted || remaining <= 0) throw e;
    return attempt(remaining);
  }
}

async function postJsonOnce(
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
        // No LLM API needs a POST redirect, and following one could forward the text (and the key) elsewhere.
        redirect: "error",
      });
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        throw abortError(timedOut, e);
      }
      if (isRedirectError(e)) {
        throw new ProviderError(
          "network",
          "The provider tried to redirect the request, which is blocked for safety. Check the Base URL.",
          undefined,
          { cause: e },
        );
      }
      throw new ProviderError("network", `Network error: ${e instanceof Error ? e.message : String(e)}`, undefined, {
        cause: e,
        retryable: true,
      });
    }

    if (!res.ok) {
      let detail: string;
      try {
        detail = (await readTextCapped(res)).slice(0, MAX_DETAIL_CHARS);
      } catch {
        detail = "(could not read response body)";
      }
      throw errorForStatus(res.status, detail);
    }

    try {
      return JSON.parse(await readTextCapped(res));
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (controller.signal.aborted) throw abortError(timedOut, e);
      throw new ProviderError("bad_response", "Response body was not valid JSON.", res.status, { cause: e });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
