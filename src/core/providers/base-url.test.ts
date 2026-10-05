import { describe, expect, it } from "vitest";
import { baseUrlProblem } from "./base-url";

describe("baseUrlProblem", () => {
  it.each([
    "https://openrouter.ai/api/v1",
    " https://api.openai.com/v1/ ",
    "https://example.com:8443/v1",
    "http://localhost:11434/v1",
    "http://LOCALHOST/v1",
    "http://127.0.0.1:8000/v1",
    "http://[::1]:8000/v1",
    "http://my-mac.local:1234/v1",
  ])("accepts %s", (url) => {
    expect(baseUrlProblem(url)).toBeUndefined();
  });

  it.each([
    "http://api.openai.com/v1",
    "http://192.168.1.50:8000/v1",
    "http://localhost.evil.com/v1",
    "http://127.0.0.1.evil.com/v1",
    "http://example.com",
  ])("rejects cleartext http to a non-local host: %s", (url) => {
    expect(baseUrlProblem(url)).toBe("insecure");
  });

  it.each(["https://user:pass@example.com/v1", "https://user@example.com/v1", "http://u:p@localhost/v1"])(
    "rejects embedded credentials: %s",
    (url) => {
      expect(baseUrlProblem(url)).toBe("credentials");
    },
  );

  it.each(["", "not a url", "example.com/v1", "ftp://example.com/v1", "file:///etc/passwd", "javascript:alert(1)"])(
    "rejects invalid or non-http(s) values: %j",
    (url) => {
      expect(baseUrlProblem(url)).toBe("invalid");
    },
  );
});
