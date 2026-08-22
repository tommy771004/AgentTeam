# 07 — Qualify conversation-scoped durable CLI execution

**What to build:** Qualify the complete durable external CLI harness across conversation concurrency, security boundaries, runner honesty, observability, and shipped adapters, so it can replace the legacy fixed-deadline path without regressions.

**Blocked by:** 02 — Let active work survive the five-minute boundary; 03 — Yield, snapshot, and reconnect long CLI work; 04 — Cancel once and recover only when replay-safe; 05 — Classify connector authentication separately; 06 — Model interactive and unattended wait states.

**Status:** 可交給代理

- [ ] Two different conversation threads can run external sessions independently up to `maxConcurrentRuns` without sharing activity, deadlines, output, cancellation, or settlement.
- [ ] Same-thread follow-ups retain the configured steer/queue ordering and do not start an overlapping external process accidentally.
- [ ] Every shipped external adapter uses the common session lifecycle and centrally defined timing policy or returns an explicit unsupported capability.
- [ ] External provider exit success remains execution success only and never becomes Definition of Done by itself.
- [ ] Sanitized Workspace, Outbound Data Gate, filesystem sandbox, Approval Mode, and unattended policy remain effective for the session's entire lifetime.
- [ ] Telemetry distinguishes startup, idle, absolute-cap, operation, connector-auth, cancellation, interrupted, and process-exit outcomes without storing prompt, output body, secrets, or protected data.
- [ ] Renderer reload, Host snapshot, event replay, cancellation, timeout, completion, and recovery scenarios preserve one authoritative Host state and one final settlement.
- [ ] Architecture drift guards prove UI code does not bypass `runTask`, invoke lower-level execution owners, or become canonical session storage.
- [ ] The focused durable-harness smoke exercises the highest approved seam with fake time and fake transport and completes in seconds.
- [ ] Existing loop parity, Pi Host protocol, coordinator, sandbox, outbound, automation, provider, build, lint, and complete smoke suites pass.
- [ ] Legacy blanket five-minute deadline logic and obsolete generic timeout copy are removed only after every adapter is qualified on the new path.

