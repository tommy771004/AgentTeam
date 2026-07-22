# 21 — Route every external Task source into Pi Core Host

**What to build:** Make scheduler, webhook, Telegram, background delegation, and optional external CLI integrations produce the same durable Task run and settlement contract as the composer.

**Blocked by:** 18 — Run durable Time and Proactive automation; 20 — Delegate to role-configured Child Pi Sessions.

**Status:** 可交給代理

- [ ] Every supported entry point submits through the single Task run ingress and receives a `runId` before admission.
- [ ] No timer, gateway, background worker, or integration invokes AgentSessionRuntime directly.
- [ ] Unattended sources use bounded approval timeouts and return explicit settlements to their origin.
- [ ] Optional external CLI providers are isolated Integrations behavior and do not become Pi Core or Pi CLI entry points.
- [ ] Cross-source contract tests assert equivalent admission, queueing, cancellation, archive, and finalization behavior.
