export const PROVIDER_IDS = ["openrouter", "openai", "anthropic", "openai-compatible"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(x: unknown): x is ProviderId {
  return typeof x === "string" && (PROVIDER_IDS as readonly string[]).includes(x);
}

export interface CompleteRequest {
  system: string;
  user: string;
  model: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  complete(req: CompleteRequest): Promise<string>;
}

export type ProviderErrorKind =
  "auth" | "billing" | "rate_limit" | "timeout" | "aborted" | "network" | "request" | "bad_response";

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** True when the same request may succeed on a second try (connection hiccup, 429, 5xx). */
  readonly retryable: boolean;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    status?: number,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options);
    this.kind = kind;
    this.status = status;
    this.retryable = options?.retryable ?? false;
  }
}
