# 09 — Scoped clear、hard delete 與確認 UX

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把刪除一筆、清除目前 project、清除 global 與清除所有記憶做成不同的 Host operations 與確認 UX。使用者能清楚知道 blast radius；runtime 無法取得管理級 clear，刪除後 stale projection、audit 或 WAL policy 都不會悄悄保留／復活內容。

## Acceptance criteria

- [x] delete-entry、clear-project、clear-global、clear-all 使用不同 typed operations 與 authority checks
- [x] clear-project 僅影響指定 canonical project；clear-global 不影響 project entries；clear-all 才涵蓋 profile/document
- [x] clear-all 需要明確確認並顯示 scope/count；取消確認時零 mutation
- [x] runtime tools 無法列舉或呼叫 admin clear operations，跨 scope request fail closed
- [x] 成功 delete/clear 在 transaction commit 後發布一致 revision，Learning/Settings projection invalidate/refetch 且不復活 stale entries
- [x] audit 只保留不可還原內容的 metadata；deleted text、tags 或 secret fragments 不留在 audit payload
- [x] hard-delete contract 定義 WAL checkpoint／secure-delete 能力與平台限制，UI/support copy 不誇大保證
- [x] protocol + UI smoke 覆蓋四種操作、確認取消、scope isolation、stale event 與 restart 後不可見

## Blocked by

- 03 — Authority boundary 的 scope、policy 與 idempotency
- 08 — Learning／Settings 即時 Host UI Projection

## Resolution evidence

- Pi Host 新增 `delete-entry`、`clear-project`、`clear-global`、`clear-all` 四種 typed protocol operation；admin clear 不進 runtime tool catalog，central authority 仍拒絕 runtime／temporary／跨 project 請求，typed operation 也拒絕混入 generic scope。
- `clear-project` 只接受 main canonicalize 後的 project；`clear-global` 只刪一般 global memory 並保留 USER profile／memory document；`clear-all` 才會跨所有 scope 並包含特殊條目。
- Settings 把「清除目前 scope」與「清除所有記憶」拆成不同控制。clear-all 先從 Host 取得全域總數，確認文字列出 all scope、筆數、profile/document；取消時不呼叫 mutation。
- SQLite 每次連線啟用 `secure_delete=ON`；delete/clear 在同一 write queue 中 commit 後執行 `wal_checkpoint(TRUNCATE)`，再發布 revision。能力查詢明示 best-effort 與 SSD wear-leveling、備份、snapshot 限制。
- operation audit 僅記 scope、logical key、hash/provenance 等 metadata，不寫 deleted text/tags；smoke 亦檢查刪除 marker 不存在於 audit payload／database bytes，且重啟後不可見。
- Learning projection 沿用 Ticket 08 的 monotonic revision/generation gate：mutation commit 後 invalidate/refetch，舊回應無法復活已刪內容。
- 驗證：`npm run build`、`npm run smoke:pi-parity-qualification`、`smoke-memory-scoped-delete.mts`、`smoke-memory-ui-projection.mts`、`npx oxlint src electron scripts/smoke-memory-scoped-delete.mts`、`git diff --check`。
