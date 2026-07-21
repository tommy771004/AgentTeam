# 02 — External CLI run becomes execution-only

**What to build:** Make an External CLI run share the coordinator-owned lifecycle while preserving provider-specific execution, failure reporting, and targeted cancellation.

**Blocked by:** 01 — Built-in Loop run becomes execution-only.

**Status:** resolved

- [X] External CLI success produces one terminal outcome, one Archive, and one settlement through `runTask`.
- [X] External CLI failure preserves provider evidence and releases capacity exactly once before queue replenishment.
- [X] External CLI cancellation remains targeted by `runId` and does not cancel unrelated CLI work.
- [X] The CLI execution adapter no longer reserves capacity, archives the Task run, releases capacity, or drains the queue.
- [X] External CLI remains an execution kind without Built-in-only DoD/iterate/continueGoal capabilities.
- [X] Targeted production-module/browser smoke, build, and lint pass.
