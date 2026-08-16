# 02 — Verdict 傳導至 Archive 與 RunSummary

**What to build:** run 結束後，逐輪 DoD verdict 隨既有管線持久化：ArchiveRecord 與 ThreadRunSummary 都帶 `dodVerdicts`，摘要卡與封存詳情讀得到同一份資料（外部 CLI run 無 verdict，維持誠實不補造假資料）。

**Blocked by:** 01

**Status:** resolved

- [x] ArchiveRecord 帶 `dodVerdicts`（saveToArchive 傳導）
- [x] ThreadRunSummary 帶 `dodVerdicts`（pushRunSummary 傳導）
- [x] 元件測試：摘要卡可讀到欄位；無 verdict（CLI run）時不渲染相關區塊

## Answer

`ArchiveRecord`／`ThreadRunSummary` 增 `dodVerdicts?`；`agentStore.saveToArchive` 與 coordinator `pushRunSummary` 傳導（有長度才帶，CLI run 不補造假資料）。**順帶修掉潛在 bug**：`threadStore.pushRunSummary` 的白名單從未帶 `simulated`——系列 1/6 的摘要卡「模擬執行」章在真實流程不會出現（元件測試直接傳 props 才通過）；白名單現補 `simulated` 與 `dodVerdicts`（後者限 20 筆、missing 8×200 字元）。store 級測試 2 案（帶 verdict 的 bubble 讀回一致、CLI run 欄位 undefined）。驗證：`npm test` 95 passed、`tsc -b` 綠、smoke-run-reports／run-lifecycle 回歸過。
