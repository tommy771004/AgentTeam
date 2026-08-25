# 05 — RunProcessFeed header microcopy

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

RunProcessFeed header 現有計數（`{toolCount} 個工具 · {messageCount} 則訊息`）旁加 `· 73.2k tok (7%)` microcopy（mono、`tabular-nums`、ink-3 層級）。數字來自 03 的投影；比率未知時只顯示 token。點擊展開 04 的「上下文」區塊——沿用現有 `onOpenPanel` 進入點模式，不開新視窗、不新增互斥 aside。

## Acceptance criteria

- [ ] header microcopy 顯示投影的 token 總量（與可選比率），零第二來源
- [ ] 點擊展開執行摘要的上下文區塊，行為與既有「開啟執行摘要」一致
- [ ] 無記錄的 runner（external CLI）不顯示 microcopy
- [ ] `npm run build` 通過

## Blocked by

03 — contextProjection 純投影 + smoke
04 — ContextUsagePanel + 執行摘要區塊
