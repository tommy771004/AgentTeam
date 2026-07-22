# 24 — Remove legacy Orchestration, Automation, and Memory owners

**What to build:** Contract the remaining runtime seam so Extension Packs over Pi Core are the only owners of Loop Patterns, delegation, durable automation, and long-term memory.

**Blocked by:** 16 — Recall long-term memory without owning history; 19 — Recover queues and interrupted runs safely; 20 — Delegate to role-configured Child Pi Sessions; 21 — Route every external Task source into Pi Core Host.

**Status:** 可交給代理

- [ ] No legacy engine path executes agent turns or tools outside Pi Core.
- [ ] One Orchestration Extension owns all four Loop Patterns and one Automation Extension owns queue/trigger settlement.
- [ ] Delegation creates only Child Pi Sessions and no private nested agent loop remains.
- [ ] Memory has no duplicate session-history or compaction owner.
- [ ] Composer and every external source pass parity and settlement suites after legacy deletion.
