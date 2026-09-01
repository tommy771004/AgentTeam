# 07 — CLI OAuth rotation 與帳號跟隨政策

Status: resolved
Spec: `.scratch/cli-subscription-pi-loop/spec.md`

## What to build

修正長駐 Pi Host 保留過期 OAuth snapshot 的問題。Host 在啟動、Settings refresh/update 與 builtin turn admission 前重新讀取 Codex／Claude CLI credential；同一 CLI authority 的 token rotation 與帳號切換預設同步，並提供 Host-owned persisted opt-out。關閉後跨帳號仍 fail-closed 為 conflict。

同步必須序列化，避免 Settings policy toggle 與 turn refresh 互相借用決策；Pi auth replacement 必須保持 0600 atomic rename，並避免同 process 並行 temp path 碰撞。Renderer 只能取得 policy 與 availability metadata，raw credential 不跨 IPC。

## Acceptance criteria

- [x] `followCliOAuthAccount` 是 Host persisted setting，預設開啟；renderer Settings 可切換但不讀取 credential
- [x] 同一 CLI source 的 token rotation／帳號切換在 startup、Settings 與 pre-turn 邊界被採用，長駐 Host 不需重啟
- [x] policy 關閉時跨帳號切換維持 conflict，非同 source credential 不被覆寫
- [x] refresh queue 序列化 credential 讀寫；atomic temp path 含 UUID 且最終檔案維持 0600
- [x] shipped-module smokes 覆蓋 default-follow、opt-out conflict、Host protocol round trip 與 settings migration，並在既有 gate 上
- [x] 真實 E2E 先重現 invalidated OAuth，再於同一 Host 換入目前 CLI credential 並取得 answered settlement

## Comments

2026-09-01 resolved。`smoke-pi-user-config.mts`、`smoke-pi-host-protocol.mts`、`smoke-pi-settings.mts` 與 migration smoke 均直接驗證出貨模組；`env -u SUBAGENTS_PI_SYNC_CLI_OAUTH npm run smoke` 完整主鏈 exit 0，build、oxlint 與 Electron Settings lifecycle E2E 亦通過。

真機命令 `npm run qualify:subscription-oauth-rotation` 使用隔離 state／agent dir：stale Pi credential 成功重現 invalidated OAuth failure，將隔離 CLI source 更新為目前登入 credential 後，同一長駐 Host 無 restart 取得 `settlement=answered`。腳本 finally 刪除隔離目錄，不修改原始 CLI／Pi credential。
