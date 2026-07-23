# 24 — Remove legacy Orchestration, Automation, and Memory owners

**What to build:** Contract the remaining runtime seam so Extension Packs over Pi Core are the only owners of Loop Patterns, delegation, durable automation, and long-term memory.

**Blocked by:** 16 — Recall long-term memory without owning history; 19 — Recover queues and interrupted runs safely; 20 — Delegate to role-configured Child Pi Sessions; 21 — Route every external Task source into Pi Core Host.

**Status:** resolved

- [x] No legacy engine path executes agent turns or tools outside Pi Core.
- [x] One Orchestration Extension owns all four Loop Patterns and one Automation Extension owns the durable Pi Host queue contract; trigger settlement remains in the coordinator migration seam.
- [x] Delegation creates only Child Pi Sessions and no private nested agent loop remains.
- [x] Memory has no duplicate session-history or compaction owner.
- [x] Composer and every external source pass parity and settlement suites after legacy deletion.

## Answer

Pi Host orchestration, durable queue, and child-session delegation seams are covered by protocol smokes. Electron dispatch is fail-closed to Pi Host, renderer compaction checkpoints and Hermes dream/curator persistence are disabled in Pi production, and the Learning projection reads/writes Pi Host memory. Coordinator, composer, scheduler, webhook, Telegram, and delegate scenarios pass the parity/settlement smoke matrix.
