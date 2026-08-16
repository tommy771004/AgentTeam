# 06 — RunSummaryCard 模擬執行章

**What to build:** 模擬 run 的持久化摘要卡顯示「模擬執行」章／標籤，判定與 05 的 transcript 標示同源；Archive 的 run 詳情同樣可見，確保事後回看（含重啟後）都能辨識模擬 run。

**Blocked by:** 05

**Status:** resolved

- [x] 模擬 run 的摘要卡顯示「模擬執行」章；非模擬 run 不顯示
- [x] Archive run 詳情一致顯示
- [x] 判定與 05 同源（共用條件，不重複實作）
- [x] 元件測試：條件渲染

## Answer

採比預期更強的單一真相：engine 在 run 開始時自設 `AgentState.simulated = !useLlm()`（ground truth，優於 admission 時推測）。`ThreadRunSummary`／`ArchiveRecord` 新增 `simulated?: boolean`；coordinator 的 `pushRunSummary` 帶入 `finalAgent.simulated`，`agentStore.saveToArchive` 帶入 `agent.simulated`。UI：RunSummaryCard 標頭 amber「模擬執行」章（tooltip 說明）、RecordsPage 封存詳情同章。元件測試 2 案（true 顯示、缺省/false 不顯示；需 MemoryRouter 包裹）。驗證：`npm test` 11 passed、`tsc -b` 綠、smoke-run-lifecycle / smoke-loop-runner / engine-availability 回歸全過。
