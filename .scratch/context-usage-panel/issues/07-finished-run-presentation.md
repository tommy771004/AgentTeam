# 07 — 完成後呈現

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

run 結算時把投影的 tokens 總量與 `costUsd` 寫進 `ThreadRunSummary`（optional 欄位），完成後的摘要氣泡顯示 `tokens · US$`（有才顯示）。TrajectoryPanel footer 既有 `usage.total` 行補快取與成本。外部 CLI runner 的 summary 維持現行 scalar，如實降級。舊 summary 缺欄位照常渲染（向後相容）。

## Acceptance criteria

- [ ] `ThreadRunSummary` 帶 optional `tokens` / `costUsd`，舊資料缺欄位不破壞氣泡
- [ ] 摘要氣泡顯示 tokens 與成本（缺席即省略）
- [ ] TrajectoryPanel footer 顯示快取與成本（缺席即省略）
- [ ] `npm run build` 通過；run-lifecycle smoke 全綠

## Blocked by

01 — usage 記錄擴充 + Host 補抓
03 — contextProjection 純投影 + smoke
