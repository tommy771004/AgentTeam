# 18 — Run durable Time and Proactive automation

**What to build:** Execute Time-based and Proactive Task runs from typed evidence through a durable Automation Extension and the same Pi orchestration path as interactive work.

**Blocked by:** 03 — Recover UI Projection after Host restart; 17 — Run Turn and Goal Loop Patterns over Pi turns.

**Status:** 可交給代理

- [ ] Time-based runs require a claimed schedule snapshot and Proactive runs require matcher-produced event evidence.
- [ ] Conversation wording alone produces only an automation suggestion, never an automation run.
- [ ] Accepted work enters a durable bounded FIFO queue with `runId` assigned before admission.
- [ ] Scheduled claims and once-job settlement survive Host/application restart.
- [ ] Automation uses the same Task run protocol, policy, session, and finalization semantics as interactive work.
