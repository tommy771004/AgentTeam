# 17 — Run Turn and Goal Loop Patterns over Pi turns

**What to build:** Preserve Turn-based and Goal-based product behavior while Pi Core exclusively executes the underlying agent turns and tools.

**Blocked by:** 07 — Resume, fork, and compact durable Pi conversations; 09 — Edit files with one Approval Decision; 10 — Run and cancel Pi Bash; 12 — Progressively reveal Pi tools and runbooks.

**Status:** 可交給代理

- [ ] One Task run can contain one Turn-based Pi turn or multiple Goal-based Pi turns.
- [ ] Parse, DoD, iterate, replan, cancellation, and settlement remain observable through the Host Protocol.
- [ ] The Orchestration Extension does not implement a second model/tool loop.
- [ ] One Pi session admits only one active Task run; steer joins the active turn and queue creates a later run.
- [ ] Behavioral fixtures demonstrate parity for successful, unmet-DoD, cancelled, and failed runs.
