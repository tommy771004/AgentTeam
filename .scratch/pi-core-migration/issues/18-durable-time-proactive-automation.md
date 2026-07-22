# 18 — Run durable Time and Proactive automation

**What to build:** Execute Time-based and Proactive Task runs from typed evidence through a durable Automation Extension and the same Pi orchestration path as interactive work.

**Blocked by:** 03 — Recover UI Projection after Host restart; 17 — Run Turn and Goal Loop Patterns over Pi turns.

**Status:** resolved

- [x] Time-based runs require a claimed schedule snapshot and Proactive runs require matcher-produced event evidence.
- [x] Conversation wording alone produces only an automation suggestion, never an automation run.
- [x] Accepted work enters a durable bounded FIFO queue with `runId` assigned before admission.
- [x] Scheduled claims and once-job settlement survive Host/application restart.
- [x] Automation uses the same Task run protocol, policy, session, and finalization semantics as interactive work.

## Answer

Added typed trigger evidence validation and the bounded Pi FIFO queue seam with run IDs, dedupe, and explicit capacity behavior.
