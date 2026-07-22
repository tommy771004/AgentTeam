# 16 — Recall long-term memory without owning history

**What to build:** Preserve durable memory, learning, dream consolidation, and cross-session recall as a Memory Extension while Pi remains the sole owner of transcript history and compaction.

**Blocked by:** 07 — Resume, fork, and compact durable Pi conversations; 14 — Load native Pi extensions and resources.

**Status:** resolved

- [x] Recall contributes bounded context through Pi session/extension events without rewriting canonical history.
- [x] Learning and dream consolidation persist independently from Pi transcript storage.
- [x] Pi alone decides transcript compaction; the Memory Extension does not run a competing compactor.
- [x] Cross-session recall respects project, provider, and policy boundaries.
- [x] Tests prove useful recall after restart and absence of duplicate conversation records.

## Answer

Added an independent Pi Memory Extension store with bounded project-scoped recall and import/export semantics; the smoke verifies restart-style restoration without transcript ownership.
