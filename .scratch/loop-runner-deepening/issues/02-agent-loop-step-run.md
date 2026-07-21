# 02 — agent/loop/ 建立 + stepRun 抽出(step 執行核心)

Status: 可交給代理
Type: task
Blocked by: 01

## 背景

spec.md 決議 1、3、6。`executeStepWithAgent`(engine.ts:789–1098)抽為 `agent/loop/stepRun.ts`:model-profile 降級、strategy host 接線、FC/heuristic/simulation dispatch 與 fallback(`resolveHeuristicStepOutcome` 契約不變)、safety gate(經 `deps.ask`)、outcome 塑形。engine 本 ticket 仍持有迴圈,改呼叫 stepRun — 是單 PR 內的中繼狀態。

## 變更範圍

- 新建 `agent/loop/state.ts`:`LoopRunState` + `snapshot()`(自 engine state 欄位萃取:steps / subAgents / toolCalls / tokensUsed / status / intervention / loadedCapabilityIds / unlockedToolNames)。
- 新建 `agent/loop/stepRun.ts`(`@internal`,smoke 可 true-import):輸入 = step + LoopRunState 切片 + deps(publish / ask);StepStrategyHost 回呼改綁 LoopRunState 並經 publish 發佈。
- `agent/stepStrategies.ts` 搬入 `agent/loop/strategies.ts`;`agent/stepExecutor.ts` 純函數併入,原檔改 re-export shim(標 `@deprecated`,ticket 04 刪)。
- engine `executeStepWithAgent` 改為對 stepRun 的薄委派。

## 驗收

- [ ] 新 smoke `scripts/smoke-step-run.mts`(true-import,無 regex):scripted transport 跑完整一步 × 三路徑 — FC(含 tool_call 回合)、heuristic(`needsSimulation` 顯式旗標→simulate)、simulation;斷言 output / toolCalls / capability id 聯集(cross-step resume 防斷,spec 風險 2)。
- [ ] safety gate 路徑:fake ask 回 approve / reject 各一,斷言 step 續跑 / FAILED。
- [ ] 既有 smoke chain 全綠。

## Comments
