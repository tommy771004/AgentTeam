# 03 — loopRunner 四 pattern + publish/ask ports + 型別化觸發證據

Status: resolved
Type: task
Blocked by: 02

## 背景

spec.md 決議 1–4(含實作時修訂)。四個 pattern method(runTurnBased / runGoalBased / runTimeBased / runProactive)搬入 `agent/loop/loopRunner.ts`;DoD 評估、迭代中 replan、continueGoal **持久化**(非恢復)一併進來。`LoopRequest` discriminated union 承載型別化證據,`runLoop` 入口唯一 fail-closed 斷言(CONTEXT.md「Time-based / Proactive trigger」詞條)。

**邊界修訂**(開工前二次確認,見 spec.md 決議 1):`start()` 實際混雜 Parse(啟發式+LLM 解析)、continueGoal 恢復、專案指引/OpenCode instructions、Time/Proactive 觸發驗證 —— 全部留在 engine.ts,不進 Loop Runner。Loop Runner 只從已解析的 `LoopRequest` + `LoopRunState` 開始。

## 實際變更範圍

- 新建 `agent/loop/loopRunner.ts`(673 行)+ `agent/loop/index.ts`(僅 export `runLoop`/型別)。
- `LoopRequest` union:`'turn'|'goal'` 無額外欄位;`'time'` 必帶 `ScheduleTriggerSnapshot`、`'proactive'` 必帶 `EventTriggerSnapshot`(型別取自既有 `types.ts`,未新造)。`runLoop` 入口對 time/proactive 缺證據做**真實 runtime 斷言**(非僅型別層防禦 —— 型別繞過時仍會被拒絕,見程式碼註解),`state.status='failed'` + 明確 haltReason。
- `deps.publish` 為唯一側效出口;intervention 狀態進 snapshot(safety gate 邏輯已在 ticket 02 的 stepRun.ts)。
- `deps.ask`(safety gate HITL)與新增的 `deps.waitForUserAck`(Turn-based 人工 ACK,語意不同的第二個 port)皆為純轉發,**逾時政策未搬移**,仍在 engine 的 `waitForIntervention()`(見決議 4 實作時修訂 —— 與 Parse 留 engine 同一脈絡:safety-critical 計時邏輯留在其唯一呼叫路徑旁,降低搬移風險;可獨立排程為後續 follow-up)。
- `onGoalIncomplete`/`onGoalCleared` port:continueGoal snapshot 建構(`buildContinueGoalSnapshot`)進 loopRunner;實際 threadStore 寫入(UI store 側效)留 engine 實作。
- `noteLearningSuccess`/`noteLearningFailure`/`synthesizeResultLocal`/`deriveReportTitle`/`resultAwaitsReply`/`finalizePatternRun`/`finalizeSuccess` 全部搬入 loopRunner(純邏輯或呼叫 module-level `learningLoop` 單例,無 UI store 依賴,不需要 port)。
- engine.ts 對應方法(setSubAgent/setStep/updateProgress/refreshKnowledge/executeStepWithAgent 及全部四 pattern + finalize 系列)一併刪除(非留待 ticket 04 —— 確認為 ticket-02 起已孤兒或本 ticket 直接孤兒化後立即清除,避免死碼累積);`engine.ts` 1702→808 行。
- 副作用發現:`agent/loop/` 的 transitive 依賴圖(`dodEvaluator.ts`→`llm.ts`、`hermes/learning.ts`→`memory/skills/textSimilarity/subdesign/preference`)有 5 個免副檔名 import 需要 `.ts` 補齊才能在 `node --experimental-strip-types` 下 true-import(沿用 ticket 02 的自動修復腳本,純加法)。

## 驗收(已完成)

- [x] 新 smoke `scripts/smoke-loop-runner.mts`(9 tests):
  - Turn-based 單輪完成(chat-lite auto-ACK,不觸發 waitForUserAck)。
  - Goal-based:scripted transport(以「驗收代理」marker 區分 DoD 呼叫 vs step 執行呼叫)令 DoD 首輪 fail → replan → 次輪 met,斷言 `currentIteration===2`。
  - Goal-based:max iterations 未達 DoD → `status='failed'` + `onGoalIncomplete` 呼叫一次。
  - Time-based / Proactive:缺證據(`as unknown as LoopRequest` 繞過型別)→ runLoop 入口 refused,無 step 執行。
  - Time-based / Proactive:合法 claim/evidence → 執行並經 `finalizePatternRun` 完成。
  - abort 於 Goal 迭代中 → 收斂為 `halted`。
  - publish 序列涵蓋 status 遞進。
- [x] 既有 smoke chain 全綠(修正 `smoke-caps.mjs` 3 則因方法搬遷而斷裂的 regex 斷言,改指向 `agent/loop/loopRunner.ts`)。
- [x] `npx tsc -b` / `npx oxlint src` 全乾淨。

## Comments
