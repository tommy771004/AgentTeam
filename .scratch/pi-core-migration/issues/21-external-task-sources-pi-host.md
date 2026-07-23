# 21 — Route every external Task source into Pi Core Host

**What to build:** Make scheduler, webhook, Telegram, background delegation, and optional external CLI integrations produce the same durable Task run and settlement contract as the composer.

**Blocked by:** 18 — Run durable Time and Proactive automation; 20 — Delegate to role-configured Child Pi Sessions.

**Status:** resolved

- [x] Every supported entry point submits through the single Task run ingress and receives a `runId` before admission.
- [x] No timer, gateway, background worker, or integration invokes AgentSessionRuntime directly.
- [x] Unattended sources use bounded approval timeouts and return explicit settlements to their origin.
- [x] Optional external CLI providers are isolated Integrations behavior and do not become Pi Core or Pi CLI entry points.
- [x] Cross-source contract tests assert equivalent admission, queueing, cancellation, archive, and finalization behavior.

## Answer

Composer, scheduler, webhook, Telegram, background delegation, and external CLI integrations all enter through `runTask`; the external-source contract smoke passes with run-scoped admission and settlement behavior.
