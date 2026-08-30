# 05 — Diff scopes、file manifest 與 lazy paging

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

建立 `WorkspaceReviewProjection` deep module，統一讀取 snapshot、working tree、staged、branch range、snapshot range。先回 metadata/manifest，再依 file cursor 取得 bounded hunks；Host 隱藏 Git command、root detection、path validation、timeout/cancel/cache 與特殊檔案處理。

## Acceptance criteria

- [x] 每個 response 帶 target provenance、revision、complete/partial 與 omitted counts/bytes
- [x] 任意大 review 仍能搜尋並選取任意檔案，不需先載完整 patch
- [x] refresh 只接受 mutable target；missing snapshot 不 fallback live
- [x] spaces/non-ASCII/Windows-style path、worktree、nested repo、rename/binary/submodule fixtures 通過
- [x] timeout/cancel/retry 不造成永久 Loading 或把 partial 當 complete

## Blocked by

01 — Review target 與 attribution contract; 03 — Host-owned ReviewArtifactStore; 04 — Snapshot capture 與歸屬 fidelity

## Comments

- 2026-08-30：新增 Host-only `WorkspaceReviewProjection`，以同一 discriminated target contract 讀 run snapshot、live working tree、staged、branch range 與 snapshot range。`describeTarget` 先回 provenance/revision/capabilities；`listFiles` 支援 query/cursor/limit；`readFileDiff` 再依 file lazy-load bounded hunks。payload body 只經 Host store 的 integrity-checked payload read，不進 renderer store、Turn Record 或 summary。
- Correctness：run/snapshot range immutable 且拒絕 refresh；missing snapshot 回 typed missing，永不 fallback live；live/staged revision CAS 不符回 stale；branch range immutable。每頁明列 complete 或 next cursor、omitted items/bytes/reasons；abort/timeout 為 typed terminal response，可安全 retry。
- Gate evidence：`smoke-workspace-review-projection.mts` 覆蓋 snapshot/live/staged/branch/snapshot-range、manifest search、hunk byte paging、missing/no-fallback、immutable refresh、stale revision、cancel，以及 spaces、non-ASCII、Windows-style path；rename/binary/submodule/worktree/nested fixtures由同一 gate 前置的 capture/binding smokes覆蓋。aggregate focused gate、TypeScript、oxlint、tracker guard 與 diff check 全綠。
