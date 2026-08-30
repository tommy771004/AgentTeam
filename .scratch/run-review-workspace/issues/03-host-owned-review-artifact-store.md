# 03 — Host-owned ReviewArtifactStore

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

建立 Host-only `ReviewArtifactStore` deep module：production SQLite/WAL adapter 與 deterministic in-memory adapter 共用小型 async interface。以 transaction 保存 snapshot metadata、manifest、paged payload refs、hash、comments/review state refs 與 tombstones；renderer 只拿 bounded projection。

## Acceptance criteria

- [x] schema/version migration、WAL/open/close/restart lifecycle 可重入
- [x] `ready` transaction 不可能指向缺失 manifest/payload；hash 不符回 typed corruption/partial
- [x] 大型 payload 不寫入 renderer localStorage、thread bubble 或 Turn Record body
- [x] begin/finalize/read/delete 在兩個 adapters 通過相同 contract smoke
- [x] SQLite authority 與 DurableMemoryStore／Instruction Repository 使用不同 DB、tables 與 protocol methods

## Blocked by

01 — Review target 與 attribution contract

## Comments

- 2026-08-30：新增 Host-only `ReviewArtifactStore` deep module，in-memory 與 `node:sqlite` WAL adapters 共用 `beginRun/finalizeRun/read/deleteArtifact/close` async seam。SQLite 使用獨立 `review-artifacts.sqlite` 與 `review_*` tables，production Pi Host admission 會 idempotently 建立 pending artifact；manifest、payload blobs、hashes、comment/review refs 與 tombstone 在單一 transaction 內提交，renderer bridge 不取得 payload body。
- Gate evidence：`smoke-review-artifact-store.mts` 對兩個 adapters 跑同一 contract，並覆蓋 WAL/schema tables、idempotent close/restart、failed finalize rollback、future schema fail-closed、實體 DB payload tamper typed corruption；已由 `smoke:review-workspace-binding` 掛入主鏈。node/app TypeScript、oxlint、complexity 與 tracker guard 全綠。
