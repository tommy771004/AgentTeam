# Active Run Reattachment 決策記錄

日期：2026-08-26

狀態：Accepted

## 決策

採用 ticket 01 的 **B：Pi Core Host child 的 run attachment journal**。

Pi Core Host 是 agent 執行核心，也是 active run、Turn Record high-watermark、approval state 與 terminal settlement 的唯一真相來源。Electron main 的 `piHostSupervisor` 只保留 transport 所需的 pending request 與 renderer subscription，不建立另一份可獨立演進的 attachment record；renderer 的 Zustand／localStorage 仍只是可拋棄的 UI Projection。

這裡區分兩種容易混在一起的「結算」：

- **Pi execution settlement**（answered／empty／failed／cancelled／interrupted）由 Pi Core Host 決定並寫入 journal，terminal 後不可被 late event 改寫。
- **Task run app finalization**（summary bubble → afterRun → Archive → `onSettled` → capacity release → drain）仍只經 `taskRunCoordinator.finalizeTaskRun`。重新附著只把 Host 已決定的 terminal outcome 交回這個既有出口，不新增 ingress 或 coordinator。

因此沒有移動既有 execution 或 app finalization 的 owner；本 effort 是把 ADR-0039 的 Host-canonical／snapshot-plus-cursor 契約補齊。

## 落地與介面

- attachment metadata 寫入 Pi Host 現有的持久化 Host state／journal，與對應的 `runId`、`sessionId`、`threadId`、turn identity 綁定。
- Turn Record entries 不複製進 attachment metadata；snapshot／backfill 仍從同一份 session Turn Record 依 cursor 分頁讀取。
- Pi Host Protocol 新增 versioned attach／ack／active-run query 合約；protocol 由 v2 升到 v3。Electron main 與 preload 只做 typed relay，renderer 必須以 `window.subagents?.piHost` feature-detect。
- Host restart 仍不承諾續跑。重啟後 journal 中沒有 live execution witness 的 active record 必須誠實轉成 `interrupted`；本 effort 的成功標準仍只涵蓋 renderer reload。

## 有界保留

- active record：保留至 Host 產生 terminal settlement；數量受 admission／`maxConcurrentRuns` 上限約束，不可因 renderer ack 被刪除。
- terminal record：先到者為 renderer ack 或 24 小時 TTL；ack 冪等。
- terminal record 硬上限 256 筆。清理順序為已 ack → 已過 TTL → 最舊 terminal；active record 永不為了騰空間而被逐出。
- 每筆 terminal outcome 的 renderer-facing bounded summary 最多 64 KiB；不保存 prompt、完整工具輸出、raw connector token 或其他 credential。
- 每次 attach 最多回傳 200 筆 Turn Record entries。回覆必須帶 `latestSeq`、`total`、`availableFromSeq` 與明確 gap，讓截斷可見。

因此 attachment metadata 的常駐上界是「active admission 上限 + 256 筆 terminal metadata」；Turn Record 本身沿用既有分頁與持久化政策，不因 reattachment 再複製一份。

## ADR 處置

- **不新增 ADR**：ADR-0039 已決定 Pi session store／Host run journal 是唯一權威，renderer 是 snapshot + cursor 重建的 disposable projection。
- **Pi Host Protocol 必須升版**：依 ADR-0038，新增 attach／ack／active-run contract 時由 v2 升到 v3，並更新 capability negotiation、generated／shared types 與 protocol smoke。
- ADR-0040 的 automation queue journal 不被拿來當第二份 attachment truth；實作可共用同一 Host state persistence substrate，但 record type、retention 與 settlement 語意必須分開。
- 若實作需要把 `taskRunCoordinator` 的 app finalization 搬進 Host、讓 renderer 直接 admission，或新增第二個 coordinator，必須停止並另寫 ADR；本決策不授權這些變更。

## 被否決的方案

否決 A（main-only `piHostSupervisor` record）。它雖能用較小改動跨 renderer reload，卻讓 main 擁有一份可與 Pi Host run／Turn Record 分歧的執行真相，違反 ADR-0039，也會讓之後的 Host restart recovery 必須再搬一次資料模型。main 可以轉送與緩衝 transport event，但不能成為 lifecycle truth owner。
