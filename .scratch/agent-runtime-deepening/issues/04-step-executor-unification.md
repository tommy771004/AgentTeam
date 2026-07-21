# 04 — 步驟執行 seam 統一

**What to build:** 三條步驟執行策略（function-calling、heuristic、simulation）收攏到一個共用輸入／輸出介面後面。步驟編排器保留步驟前置（safety gate、model 能力降級、vision 圖片降級）與步驟後置（confidence、Definition of Done 判斷、狀態更新）於自身，只有「取得步驟輸出」這一段透過策略介面分派——三條策略內部形狀本來就不同構，介面不強迫共用迴圈結構。兩個真正可共用的邏輯抽成獨立匯出函式：capability／preload／blocked-tools 組裝邏輯、以及「核准之後→執行→限流→記錄→afterTool hook」的收尾邏輯（只涵蓋 heuristic 路徑實際碰到的工具種類：內建與 custom／connector，不含 MCP／delegate／框架工具）。heuristic 路徑執行 custom 工具跳過 `afterTool` hook 的既有缺口，在改用共用收尾邏輯後修正（非保留）。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 共用 `StepExecutor` 介面型別：輸入／輸出契約已定義。
- [x] 三個策略 adapter 各自成檔（`stepStrategies.ts`）：function-calling／heuristic／simulation；互不 import。
- [x] 步驟編排器外部方法簽章零改動；只分派「取得步驟輸出」；safety／vision／DoD 後置仍在 engine。
- [x] capability／preload／blocked-tools 組裝邏輯共用（`buildStepCapabilityPreload`）。
- [x] 「核准後→執行→限流→記錄→afterTool hook」收尾共用（`finalizeAuthorizedToolCall`）；custom 工具 afterTool 缺口已修。
- [x] LLM 失敗 → simulation fallback 由編排器擁有（`HeuristicLlmFailedError`）；策略不知彼此存在。
- [x] 真 import smoke：`smoke-step-executor.mts`（含 adapter wiring）。
- [x] `tsc` / smoke / oxlint 綠。

## Comments

### Grilling session 決策摘要（2026-07-20）

- 範圍決定：保留完整 StepExecutor 統一野心（未縮小到只做兩個共用 helper）。
- 關鍵事實：heuristic 完全不碰 MCP／delegate_task／run_code／框架工具，這些留在 function-calling 專屬，共用收尾範圍因此可以縮得很乾淨。
- heuristic 不是迴圈（單次固定清單），function-calling 才是真正多輪迴圈——共用介面統一輸入輸出，不強迫共用迴圈結構。
- 對標 Claude Code 桌面版公開文件驗證：所有工具呼叫不分來源都走同一條 authorize→execute→hook 管線，沒有文件記載的例外；custom 工具跳過 hook 的既有缺口經確認屬於異常，不是可援引的設計選擇——本 ticket 據此判定修正而非保留。
- 不開 ADR：可逆內部重構，範圍大小不是 ADR 判準。

## Answer

### Phase A (helpers, 2026-07-20)

- `stepExecutor.ts` — types + `buildStepCapabilityPreload` + `finalizeAuthorizedToolCall`
- custom-tool afterTool gap fixed

### Phase B (thin adapters follow-up, 2026-07-20)

- `app/src/agent/stepStrategies.ts`:
  - `createFunctionCallingStepExecutor` — thin wrap of `runFunctionCallingLoop`
  - `createHeuristicStepExecutor` — tools + plain LLM; throws `HeuristicLlmFailedError` on LLM failure
  - `createSimulationStepExecutor` — deterministic prose + delay
  - `createStepStrategies(host)` factory
- `engine.executeStepWithAgent` dispatches only; owns FC vs heuristic selection and heuristic→simulation fallback
- Strategies never import one another
