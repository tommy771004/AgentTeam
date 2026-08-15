# Run UI lifecycle

`docs/ui` 的元件不是獨立 demo；它們是同一個 task run 的不同視圖。執行引擎只產生事件，畫面由 `app/src/agent/runLifecycle.ts` 將 activity phase、agent status 與 terminal digest 統一成一個 presentation state。

## Lifecycle grammar

| Phase | Primary surface | Supporting surfaces | User action |
| --- | --- | --- | --- |
| `starting` | Loading State + Prompt Bar | source/project context | 可停止、可查看執行摘要 |
| `planning` | Task Rows | Context Cards | 展開計畫、查看來源 |
| `thinking` | Thinking | Tool Chips | 預設收合，必要時檢視推理摘要 |
| `executing` | Tool Chips + Task Rows | Code Block / Context Cards | 展開單一操作 |
| `awaiting_user` | Approval / question surface | current task row | 回覆或取消；不使用 shimmer 假裝仍在運算 |
| `manual_intervention` | approve | safety evaluation / proposed payload | 核准、編輯後核准或拒絕 |
| `responding` | Streaming Text | inline citations / follow-ups | 可讀取已完成文字；不重複顯示另一份答案 |
| `finalizing` | Loading State（摘要） | Diff Table / Recommendation Card | 等待 summary、archive、queue settlement |
| `completed` / `failed` / `cancelled` | terminal Run Summary | Code Block / Diff Table / files | 重新執行、繼續或檢視證據 |

## Composition rules

1. **一個 run、一個狀態來源。** `runId` 是所有 live stream、thread summary、approval 與 queue settlement 的關聯鍵；不得用全域 `isRunning` 決定另一個 thread 的畫面。
2. **一個時刻、一個主訊息。** Header 顯示目前 phase；細節才進 Thinking、Tool Chips、Task Rows 或 Context Cards，避免 status log 與 process row 重複說同一件事。
3. **Live → terminal 只走一次。** `finalizing` 期間保留 live feed，但不再提供 stop；summary/archive/onSettled 完成後才 freeze terminal digest。late event 不得重新打開已完成的 run。
4. **等待不是運算。** `awaiting_user` 與 `manual_intervention` 使用 attention tone 和明確 CTA，不使用 shimmer/pixel loader；逾時要顯示倒數並依安全政策自動拒絕。
5. **證據晚於意圖。** Context Cards 先說明引用來源，Recommendation Card 先顯示信號與 alternatives，Diff Table / Code Block 才承載可檢查的變更證據；接受、拒絕與檢視必須是不同動作。
6. **動畫可中斷但內容不可消失。** 所有展開使用 `Reveal`，streaming / loading 使用 reduced-motion fallback；animation 只改善狀態轉換，不是狀態本身。

## Terminal contract

`RunProcessFeed` 只在 `deriveRunLifecycle(...).live` 時掛載。`RunSummaryCard` 讀取 coordinator 在 finalization 中保存的 bounded operations、tasks、files、diff 與 final status。這使 live feed 與歷史 summary 使用相同的 visual grammar，但不會讓終端狀態再啟動動畫或繼續計時。
