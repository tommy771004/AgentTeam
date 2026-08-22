# 04 — Cancel once and recover only when replay-safe

**What to build:** Make cancellation, timeout, completion, Host restart, and provider interruption converge on one authoritative settlement, while allowing resume or retry only when durable identity and replay-safety evidence justify it.

**Blocked by:** 02 — Let active work survive the five-minute boundary; 03 — Yield, snapshot, and reconnect long CLI work.

**Status:** 可交給代理

- [ ] Task run cancellation propagates to pending provider operations and the owned process tree through one cancellation path.
- [ ] Cancellation racing with normal completion, idle timeout, or the absolute safety cap produces exactly one terminal event and one settlement.
- [ ] A terminated process tree is confirmed when the platform supports confirmation; uncertain termination is represented honestly rather than reported as clean cancellation.
- [ ] Host restart or process loss marks an active external run interrupted unless recovery requirements are satisfied.
- [ ] Provider resume is offered only when a stable provider thread/session identity is present and the adapter supports the operation.
- [ ] Automatic retry occurs only from a Replay-safe Checkpoint proving later effects absent or idempotent under recorded identity.
- [ ] Non-resumable runs preserve bounded last output, terminal classification, and a safe manual next action.
- [ ] Recovery never recreates a renderer-cached run as canonical Host state and never duplicates conversation output.
- [ ] Deterministic cancellation-race and restart/recovery smokes pass alongside coordinator settlement and full smoke coverage.

