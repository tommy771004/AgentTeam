# 03 — Contract the lifecycle-control plumbing

**What to build:** Remove transitional lifecycle switches and compatibility execution entry shapes after both runner adapters rely exclusively on coordinator-owned context.

**Blocked by:** 01 — Built-in Loop run becomes execution-only; 02 — External CLI run becomes execution-only.

**Status:** resolved

- [X] No lifecycle-control flag crosses the Task run, runner-selection, or execution-adapter seam.
- [X] Runner selection accepts only a coordinator-built immutable dispatch snapshot in production.
- [X] No production execution path invents a legacy run identity or partial lifecycle context.
- [X] Compatibility entry remains a leaf adapter and cannot regain admission or finalization ownership.
- [X] Trigger lineage, attachments, project pinning, source kind, and run/thread identity remain preserved.
- [X] Targeted smoke, typecheck/build, and lint pass after the contraction.
