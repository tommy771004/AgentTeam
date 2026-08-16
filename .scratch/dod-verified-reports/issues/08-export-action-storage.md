# 08 — 摘要卡匯出與儲存落地

**What to build:** run 摘要卡的「匯出報告」動作：組 ReportSourceBundle → 序列化（MD 與 HTML 兩種格式可選）→ 落地。儲存重用 ReportModal 既有縫隙：Electron 下寫入專案 `reports/` 目錄，瀏覽器降級 Blob 下載；預設檔名含 runId 與日期。

**Blocked by:** 05, 06, 07

**Status:** resolved

- [x] 摘要卡動作區出現「匯出報告」（MD/HTML 可選）
- [x] workspaceWrite 至 reports/＋Blob fallback；檔名含 runId＋日期
- [x] 失敗回饋（寫入失敗不靜默）
- [x] 元件測試：動作觸發與格式選擇

## Answer

`src/agent/reportExport.ts`：`collectReportSource`（journal list＋archive＋threads 最新 run 摘要）→ `exportRunReport`（模型→序列化→落地）：Electron＋有專案根目錄時 `tools.workspaceWrite('reports/report-<runId>-<YYYYMMDD-HHmm>.<fmt>')`，否則 Blob 下載降級；寫入失敗/例外改下載並回顯訊息（不靜默）。為此補 `runId` 傳導（ThreadRunSummary＋白名單＋coordinator）。RunSummaryCard 展開區新增「匯出 Markdown／匯出 HTML」動作列＋訊息回顯（動態 import stores，避免元件層靜態依賴）。元件測試以 vi.mock 斷言格式呼叫與訊息。101 tests passed、`tsc -b` 綠。
