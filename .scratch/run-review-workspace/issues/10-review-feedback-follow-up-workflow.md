# 10 — Review feedback follow-up workflow

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

「送交 Agent 修改」將 comment bundle、snapshot identity 與 workspace binding 組成正常 Task run input；所有路徑仍經 `taskRunCoordinator.runTask`，沿用 same-thread steer/queue ordering、run-scoped settings 與 Outbound Data Gate。完成後自動建立下一版 snapshot 與 A→B review link。

## Acceptance criteria

- [x] UI 無 `dispatchThreadTask`／`startExecution` 直接呼叫；review follow-up 只有一個 run ingress
- [x] comment body/anchor/provenance 在 admission 凍結，排隊期間修改 draft 不污染已送 run
- [x] same-thread steer/queue、different-thread concurrency 與 external CLI capability disclosure 正確
- [x] 新 snapshot 產生後可比較 A→B，comments 轉 resolved/outdated 且舊 snapshot 不變
- [x] retry/cancel/reload 不重複送出 comment bundle 或建立兩個 follow-up runs

## Completion evidence

- `reviewFeedbackRun` 是唯一 review follow-up ingress：Host 先 prepare／claim immutable bundle，再以 deterministic run id 呼叫一次 `taskRunCoordinator.runTask`；進入 ingress 後失敗不會 release claim，避免 retry／reload 重送。
- Review source 納入共用 interactive conversation policy，沿用 same-thread steer/queue、different-thread concurrency、run-scoped settings 與 external CLI reduced-capability disclosure。
- Host-owned `ReviewStateStore`（in-memory／SQLite WAL）保存 feedback bundle claim；comment body、canonical anchor、provenance、thread 與 workspace binding 在 admission 前凍結。
- settlement 後由 canonical run summary 建立 B snapshot、回傳 A→B target，安全 rebase／outdated comment state 並保持 A manifest immutable。
- `smoke-review-feedback-workflow`、`smoke-review-state-store`、`smoke-review-settlement-integration`、整組 `smoke:review-workspace-binding` 與 `npm run build`：通過。

## Blocked by

06 — Settlement、summary 與 Archive 整合; 09 — Pinned comments 與 reviewed state
