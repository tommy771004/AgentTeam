# 06 — 移除遺留 engine 與 loopRunner

**What to build:** 滿足 ADR-0045 的刪除門檻後,把遺留的 browser-compat 執行路徑(agent engine + loop runner)整個移除,abort/timeout 從此只存在於 Pi Host 一處。刪除順序:先將相關 smoke drift guards 改指新 owner → 移除 UI 對 engine 的殘餘引用 → 砍檔;新增 source-text drift guard 斷言 repo 內零殘餘 import。**本 ticket 必須是獨立 PR,不可與其他 resilience tickets 混雜(revert 邊界隔離)。**

**Blocked by:** 01 — Abortable turn 協定(abort 能力已在生產路徑就位)、02 — Per-turn timeout、04 — Resume from checkpoint(遺留路徑的最後使用者都遷移完)

**Status:** resolved

- [x] 相關 smoke drift guards 改指新 owner,未弱化任何 guard
- [x] UI 層對遺留 engine 的殘餘引用移除
- [x] engine 與 loopRunner 檔案刪除
- [x] 新增 source-text drift guard:斷言 repo 內無殘餘 import
- [x] 全部 build(typecheck)與 smoke 通過
- [x] 本 ticket 以獨立 PR 交付

## 實作備註

- 刪除範圍：`agent/engine.ts`、`agent/loop/`（loopRunner / stepRun / stepIO / strategies / state / index），以及只有它們在用、刪除後成為孤兒的 `agent/dodEvaluator.ts` 與 `agent/llmParser.ts`。
- 一併移除只為遺留 engine 存在、在 Electron 生產環境早就是死控制項的 UI：`InterventionOverlay` / `InterventionPanel`、`RunContinuationActions` 的「繼續回合」、`ExecutionPage` 的 ACK 與 intervention 區塊、`agentStore.continueTurn` 與 `resolveIntervention`。這些路徑都經 `loadLegacyEngine()`，而它在 Pi Host 可用時一律 reject 並被 `.catch(() => {})` 吞掉。
- `startExecution` 在沒有 Pi Host bridge 時改為誠實丟錯，不再退回瀏覽器 engine。純瀏覽器預覽從此不能執行任務（符合 ADR-0046 electron-only 的既定方向）。
- Drift guards 全部改指新 owner，未弱化：run registry → agentStore、project guidance → projectContext/promptBuilder、model capability → modelProfile、trigger 准入 → taskRunPolicy、DoD/iteration → piOrchestrationExtension/piHostProtocol、plan bubble → parser/coordinator、unattended → coordinator+approvalDecision。
- 原 `agent/loop` allowlist guard 改寫為零殘留 guard（`findLegacyEngineResidue`）：斷言 repo 內沒有任何對已刪檔案的 import 或字串引用，且兩個路徑確實不存在。
- 四支只測遺留 loop 內部的 smoke（loop-runner / loop-parity / step-run / step-executor）隨程式碼刪除，其中仍成立的斷言原文搬到新的 `smoke-runner-contract.mts`：runner capability matrix、continueGoal 契約與 prompt、HITL timeout 政策、Time-based/Proactive fail-closed 准入（仍以行為驅動，不是 source-text）。
