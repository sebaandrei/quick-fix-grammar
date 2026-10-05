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

function kindOf(err: unknown, name: string): string | undefined {
  if (err && typeof err === "object" && (err as { name?: string }).name === name) {
    return (err as { kind?: string }).kind ?? "";
  }
  return undefined;
}

/** Maps any thrown error to a short, user-facing message. Pure. */
export function toUserMessage(err: unknown): UserMessage {
  if (err instanceof NoSelectionError) {
    return { title: "No text selected", message: "Select some text first, then run the command." };
  }
  const input = kindOf(err, "InputError");
  if (input !== undefined) {
    if (input === "too_long") {
      return { title: "Text too long", message: "Selection is over 4,000 characters. Select a shorter passage." };
    }
    return { title: "Nothing to fix", message: "The selection is empty." };
  }
  const provider = kindOf(err, "ProviderError");
  if (provider !== undefined) {
    switch (provider) {
      case "auth":
        return {
          title: "Invalid API key",
          message: "The provider rejected your API key (401). Check it in extension preferences.",
        };
      case "rate_limit":
        return { title: "Rate limited", message: "Too many requests (429). Wait a moment and try again." };
      case "timeout":
        return { title: "Request timed out", message: "The provider took too long to respond. Try again." };
      case "network":
        return { title: "Network error", message: "Could not reach the provider. Check your connection and base URL." };
      default:
        return { title: "Bad response", message: "The provider returned an unexpected response. Try again." };
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { title: "Something went wrong", message: msg };
}
