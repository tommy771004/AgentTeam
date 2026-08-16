# 05 — Simulation run 的 transcript 標示

**What to build:** Task run 以本地模擬策略執行時，chat transcript 投射一條明確的系統訊息（例如「本 run 以本地模擬策略執行（未使用語言模型）」），讓事後審視不會把模擬輸出誤當真實執行。投射條件（何時判定為 simulation run）為純邏輯並進 smoke；真實 LLM run 與外部 CLI run 都不得誤標。

**Blocked by:** 01

**Status:** resolved

- [x] 模擬策略的 run 在 transcript 出現系統訊息
- [x] 真實 LLM run 與外部 CLI run 不出現
- [x] smoke：投射條件真值表（策略 × 來源）
- [x] 文案與 02 定義的狀態 key 同源

## Answer

新模組 `src/agent/simulationMarking.ts`：`isSimulationRun({runner, llmEnabled, llmApiKey, overrideUseLlm})` 對齊 engine `useLlm()` 語義（builtin 且 LLM 未設，或 overrides.useLlm===false；外部 CLI runner 一律不標）＋`SIMULATION_NOTE` 文案。taskRunCoordinator 在 thread bind 後、dispatch 前（user bubble 與 sourceLabel 之後）對非隱藏 thread 投射系統訊息 `thr.pushBubble(tid, 'system', SIMULATION_NOTE)`——涵蓋 composer/slash/scheduler/webhook/telegram/delegate 全部入口（單一 ingress 縫隙）。smoke 第 5 組：runner × LLM × overrides 真值表＋空白金鑰＋文案檢查。驗證：smoke 5 groups、`tsc -b` 綠、9 元件測試、`smoke-run-lifecycle` 回歸通過。
