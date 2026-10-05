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

export type ProviderErrorKind = "auth" | "rate_limit" | "timeout" | "network" | "bad_response";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}
