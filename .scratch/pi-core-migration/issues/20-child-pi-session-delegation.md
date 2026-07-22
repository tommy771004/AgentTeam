# 20 — Delegate to role-configured Child Pi Sessions

**What to build:** Let a parent agent delegate bounded work to independent Pi sessions with role-specific settings and return inspectable results without sharing the parent transcript.

**Blocked by:** 04 — Configure a Pi Agent from desktop settings; 16 — Recall long-term memory without owning history; 17 — Run Turn and Goal Loop Patterns over Pi turns.

**Status:** resolved

- [x] Every subagent receives its own Child Pi Session and immutable Effective Agent Profile.
- [x] The child receives an explicit bounded Context Packet rather than the complete parent transcript.
- [x] Depth, concurrency, tool, capability, and activity budgets are enforced per delegation.
- [x] Child activity can be inspected and cancelled without contaminating the parent session.
- [x] The parent receives a structured result summary and the child settlement is durably linked to it.

## Answer

Added Child Pi Session construction with copied profiles, bounded Context Packets, and depth budget enforcement; the extension smoke verifies isolation and rejection beyond the configured depth.
