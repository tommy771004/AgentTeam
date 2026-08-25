# 03 — contextProjection 純投影 + smoke

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

新增 `projectContextUsage(record, { contextWindow? })` 純投影，與 conversationProjection / runOperationsProjection 同族同純度合約（no I/O、no store、no clock）。輸出：

```
{ steps, messages: {user, assistant}, toolCalls,
  tokens: {input, output, cachedRead, cachedWrite, total},
  costUsd?, breakdown: {assistant, tool, user, reasoning},
  contextWindow?, ratio?, lastActivityAt }
```

語意：token/cost 只加總 `stepTimings()` 的實測值；進行中 step 標 running 不猜數字；細分比例按 entry 種類字元量估算（量測值永遠優先，估算只做比例呈現）；比率只在 contextWindow 已知時計算。本票是本 effort 的**唯一測試接縫**：新 smoke 以 fixture record 直餵投影（no Electron、no store），比照 conversation-projection smoke 模式，掛進 `smoke` 鏈；四支既有投影 smoke（conversation / run-operations / live-timeline / trajectory-paging）延伸確認新 usage 欄位不破壞既有投影。

## Acceptance criteria

- [ ] `projectContextUsage` 純度合約（原始碼禁用斷言比照既有投影 smoke）
- [ ] fixture 斷言：加總、計數、細分、比率、costUsd 缺席語意、running step 不產生猜測值
- [ ] 向後相容：缺新 usage 欄位的舊記錄投影輸出不變
- [ ] 新 smoke 掛進 `smoke` 鏈；四支既有投影 smoke 全綠
- [ ] `npm run build`（typecheck）與 `npx oxlint src` 通過

## Blocked by

01 — usage 記錄擴充 + Host 補抓
