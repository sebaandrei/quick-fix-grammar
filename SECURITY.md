# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting (Security tab, "Report a vulnerability") instead of a public issue. Include what you found, how to reproduce it, and the impact you expect.

## What this extension handles

- **Your API key**, stored by Raycast as a password preference. It is sent only in request headers, only to the fixed endpoint of the chosen provider (OpenRouter, OpenAI, Anthropic) or to the Base URL you set for the OpenAI-compatible provider. That URL must be `https://`, or `http://` only for localhost, 127.0.0.1, [::1] and `*.local`, and must not contain credentials. Redirects are not followed.
- **Your selected text**, sent to that same provider and nowhere else. The extension does not log, store or cache it.
- **The model's answer**, pasted over your selection. Control, bidi, zero-width and Unicode tag characters are removed, over-long answers are rejected, and nothing is pasted if the frontmost app changed during the request.

See the Privacy section of the README for the full list, including the clipboard.

## Dependencies

- `package-lock.json` is committed; install with `npm ci`.
- The only runtime dependency is `@raycast/api`. CI audits production dependencies and Dependabot proposes updates.
- Known, accepted: two low-severity esbuild advisories that come through `@raycast/api` and affect only Windows development servers.
