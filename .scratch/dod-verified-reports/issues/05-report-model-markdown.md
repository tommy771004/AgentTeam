# 05 — 報告文件模型與 Markdown 序列化器

**What to build:** 純函數報告產製核心：ReportSourceBundle → 文件模型 → Markdown。內容含 objective、DoD 文本與逐輪判定（收斂歷程）、最終信心度與迭代數、執行軌跡摘要（工具呼叫、檔案變更、sub-agents）、失敗/部分完成的 gap 清單與下一步建議、retry 來源鏈。遮敏內建（沿用 Protected Data 排除與「決策不含內容」原則）；外部 CLI run 固定帶誠實標章。golden fixtures 進 smoke。

**Blocked by:** 01, 04

**Status:** resolved

- [x] 文件模型（結構化、與序列化正交）
- [x] Markdown 序列化：成功 run、部分 gap、CLI run、retry 鏈 golden fixtures
- [x] 遮敏：fixture 含敏感模式（token/金鑰形狀）驗證不進輸出
- [x] 純函數：不讀 store、不觸 IPC

## Answer

`src/agent/runReport.ts`：`buildRunReportModel(bundle, {generatedAt})` → `renderRunReportMarkdown(model)`。模型含收斂歷程（dodConvergence）、`verifiedCompletion`（最終輪語意驗收通過；啟發式 met 只算「執行完畢（未驗證）」）、缺口清單＋建議、檔案變更、執行軌跡、sub-agents、血緣鏈、缺件標記。CLI run 引用既有 `EXTERNAL_CLI_DOD_LABEL` 標章。遮敏：`redactReportText` 樣式集（sk-/Bearer/ghp_/xox/AKIA/PEM）雙層——模型層（objective 進 title）＋序列化層。**發現並修復**：objective 進 title 時未遮敏的洩漏（模型層補遮）。另為報告需要補 `definitionOfDone` 傳導（ArchiveRecord/ThreadRunSummary＋saveToArchive/pushRunSummary 白名單）。smoke 第 5 組：成功/gap/CLI/遮敏四形態。`tsc -b` 綠、元件測試 95 passed。
