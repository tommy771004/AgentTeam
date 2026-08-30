# 14 — Restart、export/import 與 retention

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

完成 Review artifact 的 durable lifecycle：SQLite restart/WAL recovery、pending/capturing 收斂、archive、preview-first atomic export/import、project rebind、reference-aware retention、payload GC、tombstone 與 hard delete。Renderer hydration 不得復活 Host tombstone。

## Acceptance criteria

- [x] crash at begin/manifest/payload/commit 各 phase 後重啟收斂為 ready/partial/failed，無半份 ready
- [x] export manifest 包含 schema/hash/bytes/refs；import 先 preview collision/unsupported/missing，再原子 commit
- [x] archive 保留 snapshot/comments/review state/verification；hard delete 才移除 canonical records
- [x] retention 不清除仍被 thread/comment/range 引用的 payload，GC 後 metadata tombstone 說明原因
- [x] project moved/rebound 不改 snapshot identity 或歷史 display provenance

## Blocked by

03 — Host-owned ReviewArtifactStore; 06 — Settlement、summary 與 Archive 整合; 09 — Pinned comments 與 reviewed state

## Verified so far

- Production SQLite open 會收斂既有 `pending`／`capturing` records；begin、manifest-only、payload-only 與 commit-boundary fixtures 均轉為 `failed` 並清除半份 rows，已 committed ready artifact 維持 immutable。
- `ReviewArtifactStore` 已提供 schema/hash/bytes/refs export bundle、collision/integrity preview、CAS-bound atomic import、workspace rebind hint、reference-aware retention、tombstone 與 physical hard delete；in-memory/SQLite lifecycle smoke 均通過。
- Retention 同時保護呼叫端提供的 thread/range snapshot ids 與 artifact 自帶 comment/review-state refs；rebind 只新增 lookup hint，不改 admission 中的歷史 project provenance。
- Host protocol/preload 已提供 typed export、import preview/apply、rebind、retention 與 hard-delete；import apply 必須消耗 Host preview hash，destructive actions 經中央 Approval，renderer 無法傳入 approval object。
- Import fixtures 覆蓋 ready、collision、unsupported、missing、tamper 與 preview/apply CAS；SQLite import 在單一 transaction 寫入 metadata、manifest 與 payload。
- Archive fixture 證明 snapshot、comments、reviewed state 與 verification/output 保留；hard-delete workflow 依序移除 state、verification 與 artifact canonical owners，renderer read 只會得到 Host tombstone/not-found。
- Rebind 先重新 admission 新 project path，將新 filesystem binding 綁回原 workspaceId；artifact admission、snapshotId 與歷史 project provenance byte-stable。
- 完整 `smoke:review-workspace-binding`、focused oxlint、TypeScript、complexity gate 與 `npm run build` 通過。
