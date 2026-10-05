# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report them
privately via GitHub Security Advisories:

https://github.com/mdsa3d/yoru/security/advisories/new

Include reproduction steps and the affected version/commit. You will get a
response as soon as the maintainer can triage the report.

## Scope notes

- YORU is a static, client-side browser game; the main attack surface is the
  optional local dev server (`server.mjs`) and the optional Laya decision
  service (`--laya`).
- **`server.mjs` is a local development server, not a hardened production
  host.** It binds to `127.0.0.1`, allowlists `index.html`, `style.css`,
  `src/`, `vendor/` and `assets/`, and rejects cross-origin POSTs — but it has
  not been audited for hostile-network exposure. Do not expose it to untrusted
  networks.
- Telemetry (`?telemetry=1`) is opt-in, stored only in the browser, and never
  transmitted. There is no analytics, no tracking and no third-party network
  calls in the game itself.
