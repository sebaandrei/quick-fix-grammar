import { InputError, DEFAULT_MAX_CHARS } from "../core/run";
import { ProviderError } from "../core/providers/types";

export interface UserMessage {
  title: string;
  message: string;
}

export class NoSelectionError extends Error {
  constructor() {
    super("No text selected");
    this.name = "NoSelectionError";
  }
}

/** getSelectedText failed for a reason other than an empty selection (e.g. missing Accessibility permission). */
export class SelectionReadError extends Error {
  constructor(detail: string) {
    super(`Could not read selection: ${detail}`);
    this.name = "SelectionReadError";
  }
}

export type ConfigErrorKind = "missing_api_key" | "missing_base_url" | "missing_model";

export class ConfigError extends Error {
  readonly kind: ConfigErrorKind;

  constructor(kind: ConfigErrorKind) {
    super(CONFIG_MESSAGES[kind].message);
    this.name = "ConfigError";
    this.kind = kind;
  }
}

const CONFIG_MESSAGES: Record<ConfigErrorKind, UserMessage> = {
  missing_api_key: {
    title: "API key missing",
    message: "Set your API key in the extension preferences.",
  },
  missing_base_url: {
    title: "Base URL missing",
    message: "Set the Base URL in the extension preferences (required for the OpenAI-compatible provider).",
  },
  missing_model: {
    title: "Model missing",
    message: "Set a Default Model in the extension preferences (required for the OpenAI-compatible provider).",
  },
};

function providerMessage(err: ProviderError): UserMessage {
  const kind = err.kind;
  switch (kind) {
    case "auth":
      return {
        title: "Invalid API key",
        message: "Invalid API key or no access to this model. Check your key and model in the extension preferences.",
      };
    case "rate_limit":
      return { title: "Rate limited", message: "Too many requests. Wait a moment and try again." };
    case "timeout":
      return { title: "Request timed out", message: "The provider took too long to respond. Try again." };
    case "network":
      return { title: "Network error", message: "Could not reach the provider. Check your connection and base URL." };
    case "bad_response":
      return { title: "Bad response", message: "The provider returned an unexpected or empty response. Try again." };
    case "aborted":
      return { title: "Cancelled", message: "The request was cancelled." };
    case "request":
      return {
        title: "Request rejected",
        message: `The provider rejected the request (${err.message}). Check the model name and base URL.`,
      };
    default: {
      const unreachable: never = kind;
      return { title: "Something went wrong", message: String(unreachable) };
    }
  }
}

/** Maps any thrown value to a short, user-facing message. Pure. */
export function toUserMessage(err: unknown): UserMessage {
  if (err instanceof NoSelectionError) {
    return { title: "No text selected", message: "Select some text first, then run the command." };
  }
  if (err instanceof SelectionReadError) {
    return {
      title: "Could not read selection",
      message: `${err.message}. Check that Raycast has Accessibility permission in System Settings > Privacy & Security.`,
    };
  }
  if (err instanceof ConfigError) return CONFIG_MESSAGES[err.kind];
  if (err instanceof InputError) {
    if (err.kind === "too_long") {
      const limit = err.limit ?? DEFAULT_MAX_CHARS;
      return {
        title: "Text too long",
        message: `Selection is over ${limit.toLocaleString("en-US")} characters. Select a shorter passage.`,
      };
    }
    return { title: "Nothing to fix", message: "The selection is empty." };
  }
  if (err instanceof ProviderError) return providerMessage(err);
  if (err instanceof Error) return { title: "Something went wrong", message: err.message };
  return { title: "Something went wrong", message: typeof err === "string" && err ? err : "Unknown error" };
}
