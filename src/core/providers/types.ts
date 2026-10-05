export const PROVIDER_IDS = ["openai", "anthropic", "openai-compatible"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

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

export type ProviderErrorKind = "auth" | "rate_limit" | "timeout" | "aborted" | "network" | "request" | "bad_response";

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
    this.status = status;
  }
}
