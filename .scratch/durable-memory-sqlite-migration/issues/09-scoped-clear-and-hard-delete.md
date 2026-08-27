# 09 — Scoped clear、hard delete 與確認 UX

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把刪除一筆、清除目前 project、清除 global 與清除所有記憶做成不同的 Host operations 與確認 UX。使用者能清楚知道 blast radius；runtime 無法取得管理級 clear，刪除後 stale projection、audit 或 WAL policy 都不會悄悄保留／復活內容。

## Acceptance criteria

- [ ] delete-entry、clear-project、clear-global、clear-all 使用不同 typed operations 與 authority checks
- [ ] clear-project 僅影響指定 canonical project；clear-global 不影響 project entries；clear-all 才涵蓋 profile/document
- [ ] clear-all 需要明確確認並顯示 scope/count；取消確認時零 mutation
- [ ] runtime tools 無法列舉或呼叫 admin clear operations，跨 scope request fail closed
- [ ] 成功 delete/clear 在 transaction commit 後發布一致 revision，Learning/Settings projection invalidate/refetch 且不復活 stale entries
- [ ] audit 只保留不可還原內容的 metadata；deleted text、tags 或 secret fragments 不留在 audit payload
- [ ] hard-delete contract 定義 WAL checkpoint／secure-delete 能力與平台限制，UI/support copy 不誇大保證
- [ ] protocol + UI smoke 覆蓋四種操作、確認取消、scope isolation、stale event 與 restart 後不可見

## Blocked by

- 03 — Authority boundary 的 scope、policy 與 idempotency
- 08 — Learning／Settings 即時 Host UI Projection
