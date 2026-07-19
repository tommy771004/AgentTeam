# 01 — Built-in Loop run becomes execution-only

**What to build:** Make a Built-in Loop run execute entirely under the Task run module's admitted lifecycle, with no duplicate capacity reservation or fallback finalization inside the execution adapter.

**Blocked by:** None — can start immediately.

**Status:** 已完成並驗證

- [X] Built-in success enters through `runTask` and produces one terminal outcome, one Archive, and one settlement.
- [X] Built-in failure enters through `runTask` and releases capacity exactly once before queue replenishment.
- [X] Built-in cancellation remains targeted by `runId` and does not finalize another active run.
- [X] The Built-in execution adapter no longer reserves capacity, archives the Task run, releases capacity, or drains the queue.
- [X] Default single-run and opt-in capped concurrency behavior remain unchanged.
- [X] Targeted production-module/browser smoke, build, and lint pass.
