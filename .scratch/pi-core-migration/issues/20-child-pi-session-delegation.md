# 20 — Delegate to role-configured Child Pi Sessions

**What to build:** Let a parent agent delegate bounded work to independent Pi sessions with role-specific settings and return inspectable results without sharing the parent transcript.

**Blocked by:** 04 — Configure a Pi Agent from desktop settings; 16 — Recall long-term memory without owning history; 17 — Run Turn and Goal Loop Patterns over Pi turns.

**Status:** 可交給代理

- [ ] Every subagent receives its own Child Pi Session and immutable Effective Agent Profile.
- [ ] The child receives an explicit bounded Context Packet rather than the complete parent transcript.
- [ ] Depth, concurrency, tool, capability, and activity budgets are enforced per delegation.
- [ ] Child activity can be inspected and cancelled without contaminating the parent session.
- [ ] The parent receives a structured result summary and the child settlement is durably linked to it.
