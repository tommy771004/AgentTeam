# 05 — Classify connector authentication separately

**What to build:** Turn provider and MCP diagnostics into structured connector and adapter outcomes, so a non-fatal `AuthRequired` warning or normal stdin notice cannot masquerade as the cause of an external CLI timeout.

**Blocked by:** 01 — Expand the External CLI Run Session seam.

**Status:** 可交給代理

- [ ] MCP `AuthRequired` output is normalized into a connector-specific authentication-required event without exposing bearer tokens or credential material.
- [ ] An unavailable optional connector can emit a visible warning while unrelated provider work continues and settles successfully.
- [ ] A selected required connector or capability fails with the server, operation, and authentication classification needed for remediation.
- [ ] Normal provider diagnostics such as reading additional input from stdin remain low-severity diagnostics and are not promoted to root cause.
- [ ] The generic headless-mode recommendation appears only when adapter evidence identifies a non-headless invocation.
- [ ] Terminal error selection prefers the authoritative session classification over incidental stderr ordering.
- [ ] The captured Codex trace pattern containing stdin, Cloudflare `AuthRequired`, successful model output, and clean exit is covered deterministically.
- [ ] A matching trace that later reaches idle or absolute timeout reports the timeout separately while retaining the connector warning as supporting context.
- [ ] Focused diagnostic-classification smokes, build, and the complete smoke chain pass.

