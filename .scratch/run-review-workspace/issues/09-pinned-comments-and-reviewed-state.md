# 09 — Pinned comments 與 reviewed state

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

建立 Host-durable review comments 與 per-file reviewed state。anchor 綁 snapshot/path/side/line/hunk fingerprint/context hash；draft 送出前可編輯/刪除/總覽。新 snapshot 依 content hash 與 anchor rebase 決定 reviewed、resolved、outdated，不安靜附到錯行。

## Acceptance criteria

- [x] draft/submitted/acknowledged/resolved/outdated transition 與非法轉移 fixture 完整
- [x] restart/archive 後 comments、drafts、reviewed state 可重建
- [x] 相同內容才繼承 reviewed；內容變更標 changed-after-review
- [x] anchor 可安全 rebase 才移動，否則顯示 outdated 與原始 context
- [x] 關閉含 draft 的 tab 有確認；hard delete 才清除 canonical comment records

## Completion evidence

- 新增 Host-owned `ReviewStateStore`（in-memory 與獨立 SQLite WAL adapter）；renderer bridge 只送 typed draft／transition／reviewed intent，anchor fingerprint、context hash 與原始 context 由 Host canonical diff 推導。
- `smoke-review-state-store`：合法／非法 transition、draft edit/delete、SQLite restart、same-hash inheritance、changed-after-review、唯一 anchor rebase、ambiguous/missing outdated、hard delete 通過。
- `smoke-review-settlement-integration`：Pi Host protocol 的 draft/list/mark-reviewed 主鏈通過。
- Explorer 已有 review-state filter、durable draft 編輯/刪除/送出總覽、reviewed/open-comment 標示；關閉含 draft 分頁先確認且只隱藏 tab、保留 Host records。
- `npm run smoke:review-workspace-binding`、`npm run build`、`npx tsc -b --pretty false`、complexity gate：通過；focused oxlint 0 errors（既存 `electron/main.ts` warnings 不屬本票）。

## Blocked by

03 — Host-owned ReviewArtifactStore; 05 — Diff scopes、file manifest 與 lazy paging; 08 — Review explorer UI
