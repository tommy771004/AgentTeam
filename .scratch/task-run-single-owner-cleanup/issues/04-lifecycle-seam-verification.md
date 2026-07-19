# 04 — Verify lifecycle behavior through the Task run seam

**What to build:** Replace implementation-pinned lifecycle checks with observable Task run contracts while retaining only the static guards needed to prevent ownership drift.

**Blocked by:** 03 — Contract the lifecycle-control plumbing.

**Status:** 已完成並驗證

- [X] Real-module/browser tests cover Built-in success/failure/cancellation through `runTask`.
- [X] Real-module/browser tests cover External CLI success/failure/cancellation through `runTask`.
- [X] Tests prove one Archive, one settlement, one release, and release-before-drain for every admitted terminal path.
- [X] Tests cover hook denial, dispatch exception, duplicate `runId`, and queued replenishment.
- [X] Existing queue cancellation settlement remains tested separately for never-admitted items.
- [X] Static guards reject direct product entry into runner execution and adapter-owned finalization without pinning comments or private helper names.
- [X] Full smoke, build, targeted lint, and diff checks pass with fresh evidence.
