# 03 — Execution evidence 誠實終態、Archive 與畫面

**What to build:** 使用者與 Archive 能清楚區分 verified success、explicit simulation 與 LLM／DoD 降級；simulation 或 degraded 永遠不能以成功語義封存或觸發 success Learning。執行畫面在既有 run-scoped 表面上顯示 evidence 種類與原因。兩個並行 Loop run 各自提問時，回答或逾時其一不影響另一個（scenario 級回歸，不只 store 單元）。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [x] Archive 映射在 evidence 為 simulation／degraded 時，即使瞬時 status 字串為 success 也不得寫成 archive success。
- [x] 共享的 evidence→Archive／終態映射為 runtime 與測試的單一真相來源。
- [x] 引擎／harness fixture 覆蓋：LLM transport 失敗、malformed DoD verdict、explicit simulation → 非 success 終態且不觸發 success Learning。
- [x] Run presentation（既有執行面，非新 dialog）可見 evidence kind 與可診斷 reason／retry path。
- [x] Scenario 級：兩個並行 Loop run 同時提問；resolve 或 timeout 其一不 settle 另一 run。
- [x] 停止某一 run 只取消該 run 的 pending questions／permissions。

## Comments

### 2026-07-16 — TDD slice

- Fixed `archiveStatusForEvidence`: evidence kind checked before bare `success` status.
- `agentStore.toArchiveStatus` uses shared pure helper (single source of truth).
- `formatExecutionEvidenceLabel` + InlineRunPanel surface kind/reason.
- Scenario: concurrent manual HITL — resolve run A does not settle run B.
- Engine learning gates / terminal resolve already covered by pure + engine wiring (prior trust-04).
