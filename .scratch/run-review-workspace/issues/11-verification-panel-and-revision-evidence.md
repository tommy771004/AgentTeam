# 11 — Verification panel 與 revision evidence

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

新增驗證 tab 與 Host-owned verification records，呈現實際 command、exit code、duration、bounded output reference、runner 與 verified snapshot/workspace revision。workspace revision 改變後結果標 stale；模型文字不算通過證據。

## Acceptance criteria

- [x] `passed | failed | not-run | stale` 由 Host execution evidence 投影
- [x] build/smoke/test 多筆結果能對應同一 snapshot/revision，失敗細節可展開與重試
- [x] current revision 改變即 stale，不沿用綠色狀態到新程式碼
- [x] summary 與 verification tab 使用同一 records，不各算第二份結果
- [x] reload/archive/replay 後驗證 provenance、output availability 與缺失狀態一致

## Completion evidence

- 新增 Host-owned `ReviewVerificationStore`（in-memory／獨立 SQLite WAL），保存實際 command/args/cwd、exit code、signal、duration、runner、snapshot/workspace revision 與 bounded output reference。
- renderer 只提出 `build | smoke | test` intent；Host 從 snapshot workspace 的 package scripts 解出並執行命令。模型文字與 renderer 不可建立 passed record。
- `projectReviewVerification` 是 status 唯一 projection；current working revision 與 verified revision 不同立即投影 `stale`，缺 script 或 revision 已移動則保存 `not-run`。
- Verification tab 支援多筆記錄、失敗輸出展開、重試與 output missing；執行摘要 header 透過同一 `listVerifications` records 顯示狀態並開啟 stable verification tab。
- `smoke-review-verification` 覆蓋真 Host command、passed/not-run/stale、bounded output、SQLite restart/replay 與 summary/UI single-record source；整組 `smoke:review-workspace-binding`、focused oxlint、complexity gate、`npx tsc -b` 與 `npm run build` 通過。

## Blocked by

03 — Host-owned ReviewArtifactStore; 06 — Settlement、summary 與 Archive 整合; 07 — Browser-tab-like WorkspacePanelSession
