# 04 — 建立 Durable Run Journal 與啟動復原

**What to build:** Recover safely from process interruption while preserving run identity, queue semantics, scheduler semantics, and user-visible evidence.

**Blocked by:** None — can start immediately.

**Status:** X

- [X] An admitted active run has durable lifecycle evidence sufficient to classify it as completed, failed, cancelled, or interrupted after restart.
- [X] Startup reconciliation marks orphaned runs and jobs as interrupted instead of leaving them permanently running.
- [X] Queued work resumes at most once and remains run-scoped.
- [X] Once-jobs and background jobs do not execute twice after crash recovery.
- [X] Corrupt primary state is backed up, quarantined, or restored from last-known-good data with a user-visible recovery report.
- [X] Forced renderer termination, main-process termination, queue drain interruption, and scheduler settlement interruption are covered by real behavior tests.
