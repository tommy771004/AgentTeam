# 02 — 工具定義單一紀錄

**What to build:** 47 個工具的 catalog 說明、關鍵字提示、參數 schema、owning capability 合併成一個資料紀錄；工具名稱型別由此紀錄的 keys 導出（單一來源）。既有的 catalog／參數／各 capability 的工具清單全部改為從這個紀錄導出的視圖，呼叫端零改動。每工具恰好一個 owning capability 升格為型別強制不變量——遺漏或打錯字是編譯錯誤。既有的逐工具 execute switch 保留原樣，只加一個窮盡性檢查防止新增工具忘記處理執行分支。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 新資料紀錄涵蓋每個工具的 catalog 行、關鍵字、參數 schema、owning capability，型別為 `satisfies` 檢查過的常數。
- [x] 工具名稱型別（`ToolName`）從紀錄的 keys 導出，不再獨立宣告。
- [x] 既有 catalog／參數 schema／各 capability 的 `tools[]`，改為從紀錄導出的視圖函式，原名匯出，呼叫端 import 路徑零改動。
- [x] owning capability 型別為既有 capability id 聯集，打錯字是編譯錯誤；遺漏 owning capability 也是編譯錯誤（orphan 工具不可能存在）。
- [x] 既有逐工具 execute switch 原樣保留（不搬 I/O 邏輯），加一個 `never` 窮盡性檢查，新增工具忘記處理分支會是編譯錯誤。
- [x] 驗收即編譯：`npm run build` 紅燈涵蓋遺漏 owning capability、參數缺漏、capability id 打錯字三種情境。
- [x] 既有 `smoke-caps.mjs` 確認導出視圖行為不變（不必新增測試檔）。

## Comments

### Grilling session 決策摘要（2026-07-20）

- 選定方案：合併資料表（而非只加 `Record<ToolName, CapabilityId>` 的最小連結，也不做連 executor 都溶成 record map 的全量方案）。
- 理由：47 工具今天零重複擁有，`Record<ToolName, CapabilityId>` 放得下現實；executor 的 1253 行 I/O switch 不值得為了這次重構搬動，保留 + 窮盡檢查即可。
- orphan 工具的實際風險：heuristic 執行路徑（`selectToolsForStep` 直接掃 catalog、不看 capability）目前可選中無主工具並繞過核准——這是本 ticket 想關掉的安全洞，透過型別強制不變量解決，不需要額外測試。
- 不開 ADR：可逆內部重構。

## Answer

Implemented 2026-07-20:

- `app/src/agent/tools/toolDefinitions.ts` — single `TOOL_DEFINITIONS` record (`satisfies ToolDefinition`)
- `app/src/agent/capabilities/capabilityIds.ts` — closed `BuiltinCapabilityId` union
- Derived views: `TOOL_CATALOG`, `PARAMS`, capability `tools[]` via `toolsForCapability`
- `alsoListedIn` preserves design-critique dual listing without dual ownership
- executor switch default uses `never` exhaustiveness check
