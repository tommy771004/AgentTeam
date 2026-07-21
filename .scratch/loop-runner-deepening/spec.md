# Loop Runner 深化 — 執行核心自 engine.ts 抽出

**來源**:2026-07-21 architecture review 候選 1 + grilling 十項決議(使用者已確認共識)。
**詞彙**:module / interface / seam / adapter / depth / locality(`/codebase-design`);Loop Runner / Loop run / Time-based trigger(`CONTEXT.md`,本次已更新詞條)。

## 問題

`engine.ts`(1702 行,68 methods)仍是 god module:step-executor 重構抽走了純函數葉子,但 `start()`(≈450 行)與 `executeStepWithAgent`(≈310 行)的 orchestration 留在原地。「一步執行」的 bug 橫跨 5 個檔案;唯一的行為驗證是 `smoke-step-executor.mts` 對 engine 源碼做 regex 比對 — 1702 行的 module 用字串比對自己來「測試」。

## 目標

- `agent/loop/` 成為 **Loop Runner**:唯一對外 interface `runLoop(request, deps) → LoopOutcome`。
- `engine.ts` 縮為 ~200 行 production adapter:run registry、store 接線、ask 橋接、`configure()`。
- Smoke 能以 fake model + fake deps 跑完整 loop(四 pattern)與完整一步(FC/heuristic/simulation),不碰 zustand、不碰真 LLM。

## 非目標

- 候選 2(egress adapter)、候選 3(tool single-record)— 另立 effort。
- External CLI run(`executionKind:'external'`)不經 Loop Runner,路徑不動。
- `delegate.ts` / `backgroundJobs.ts` 的 LLM 呼叫契約不動(transport seam 順帶覆蓋,但不改其介面)。
- coordinator / `runTask` 完全不動;`agentEngine.start()` 仍是對外呼叫點。

## 十項決議

1. **範圍** — `start()` 迴圈 + `executeStepWithAgent` 全部抽出;四種 Loop Pattern 連同 pattern 選擇、DoD、replan、continueGoal 都進 Loop Runner。
   **實作時修訂**(ticket 03 開工前二次確認,見 issues/03):`start()` 實際混雜 Parse(啟發式+LLM 解析)、continueGoal **恢復**(區別於迭代中的 replan)、專案指引/OpenCode instructions 解析、以及 Time/Proactive 觸發驗證 —— 這些不是 loop 迴圈本身,CONTEXT.md 也將 Parse 視為獨立於 Loop Pattern 執行的概念。確認邊界:**Loop Runner 只從已解析的 `LoopRequest` + `LoopRunState` 開始**;Parse、continueGoal 恢復、專案指引、trigger 驗證(`validateTimeBasedTrigger`/`validateEventTriggerSnapshot`)全部留在 engine.start()。DoD、replan(迭代中)、continueGoal **持久化**(`persistContinueGoal`/`clearContinueGoal`,拆成純 snapshot 建構進 loopRunner + `onGoalIncomplete`/`onGoalCleared` port 留 engine 因為要碰 threadStore)、四 pattern 本體、learning hooks 皆進 Loop Runner。
2. **Consent-first 執行點** — `LoopRequest` 為 discriminated union:`pattern:'time'` 必帶 `ScheduledJobClaim`、`'proactive'` 必帶 `EventEvidence`(無證據呼叫過不了 tsc);`runLoop` 入口做唯一 fail-closed 斷言。發證機關(scheduler claim / eventMatcher)不動。
3. **State 擁有權** — Loop Runner 持有 plain `LoopRunState`;唯一側效出口 `deps.publish(snapshot)`;結果由回傳值 `{ state, outcome }` 承載。engine adapter 是唯一 production 訂閱者。
4. **HITL** — 單一 `deps.ask(req): Promise<AskDecision>` port;intervention 狀態同步進 published snapshot 供 UI 顯示。
   **實作時修訂**:逾時與 auto-deny 政策(unattended 45s / 互動 90s / safety 900s)**維持留在 engine 的 `waitForIntervention()`**(ticket 02 就已如此),ticket 03 未搬移 —— 這條 HITL 逾時政策與「Parse 留 engine」屬同一決策脈絡(safety-critical 計時邏輯與其唯一呼叫路徑共置,降低搬移風險);Loop Runner 的 `ask` port 本身不含計時,只呼叫並等待。若未來要把計時搬進 Loop Runner,是可獨立排程的小 follow-up,不影響本次已交付的四 pattern + 型別化證據範圍。
5. **Model seam** — `llm.ts` 增 `LlmTransport` 注入點,位於 sanitize→gate **之下**(fake 跑 smoke 時 Outbound Data Gate 一併被行使);`setLlmTransport(t?)` 供 smoke,undefined 還原預設(Electron proxy / fetch)。
6. **佈局** — 單一對外 seam:

   ```
   agent/loop/
     index.ts        // export { runLoop } — 唯一對外
     loopRunner.ts   // 四 pattern 循環 + 型別化證據斷言
     stepRun.ts      // @internal 內部 seam,smoke 可 true-import
     strategies.ts   // 自 stepStrategies.ts 搬入
     state.ts        // LoopRunState + snapshot()
   ```

   `stepExecutor.ts` → re-export shim 一版後刪;`stepStrategies.ts` 搬入後刪;`conversationLoop.ts` 直接刪(13 行 0 caller)。
7. **遷移** — 一次到位單 PR(使用者明確選擇;風險:回歸時變更面 = 整個執行核心,無中間回退點)。Tickets 為同一 branch 上的工作項,僅在 merge bar 全勾後合併。
8. **Merge bar** — 見下節,全部必勾。
9. **命名** — 「Loop Runner（迴圈執行器）」已入 CONTEXT.md;「Time-based / Proactive trigger」「Loop run」詞條已修訂。
10. **不變式** — `agentEngine.start()` 對外不變;coordinator 語彙(Task run)不變;ADR-0003 concurrency registry 不動。

## 對外 interface 契約(實作依據)

```ts
// agent/loop/index.ts
export function runLoop(req: LoopRequest, deps: LoopDeps): Promise<LoopResult>

type LoopRequest =
  | { pattern: 'turn';  ... }
  | { pattern: 'goal';  ...; maxIterations: number }
  | { pattern: 'time';      claim: ScheduledJobClaim }      // 必填
  | { pattern: 'proactive'; evidence: EventEvidence }        // 必填

type LoopDeps = {
  publish: (s: LoopRunState) => void                 // 唯一側效出口
  ask: (req: AskRequest) => Promise<AskDecision>     // HITL;逾時政策仍在 engine.waitForIntervention()
  waitForUserAck: () => Promise<void>                // Turn-based 的人工 ACK,與 ask 是不同語意
  onGoalIncomplete: (snapshot: ContinueGoalSnapshot) => void  // threadStore 側效留 engine,port 化
  onGoalCleared: () => void
  // settings/overrides/log/shouldAbort/projectGuidance/... 沿用 stepRun.ts 既有 deps 形狀
}

type LoopResult = { state: LoopRunState }
// outcome 併入 state.status/haltReason,未另開型別(YAGNI)。
```

```ts
// agent/llm.ts
type LlmTransport = (req: ChatRequest) => Promise<ChatResponse>
export function setLlmTransport(t?: LlmTransport): void   // undefined = 還原預設
// chatCompletionWithTools 內部順序:sanitize → gate → transport(req)
```

## Merge bar(全部必勾才可合併)

- [x] smoke: stepRun 三路徑(FC / heuristic / simulation)以 scripted transport 跑完整一步 —— `smoke-step-run.mts`(ticket 02)
- [x] smoke: Goal loop DoD fail → replan → met 全循環 —— `smoke-loop-runner.mts`(ticket 03)
- [ ] ~~smoke: ask 逾時 → auto-deny~~ —— 逾時政策未搬移(見決議 4 實作時修訂),此項不適用;engine 既有 `waitForIntervention` 逾時行為未變動、未新增回歸風險
- [x] smoke: time / proactive 無 claim / evidence → 入口 refused(fail-closed)—— `smoke-loop-runner.mts` 兩則(bypassing the type system via `as unknown as LoopRequest`)
- [x] smoke: publish snapshot 序列形狀不變(status 遞進、steps/subAgents 隨每次 mutation 發佈)
- [x] 既有 smoke chain 全綠(`npm run smoke`)—— 含 ticket 01/02/03 過程中修正的既有 regex smoke(engine.ts 原始碼比對段落改指向 agent/loop/*)
- [ ] 手動:dev app 四 pattern 各跑一次 + 一次真 intervention 解鎖(ticket 05,待人工 —— 剩下唯一項)
- [x] drift guard:production 碼(engine 之外)import `agent/loop` → build fail —— `smoke-caps.mjs` 純函數 `findLoopRunnerImportDrift` + fixture + 實際樹掃描(ticket 04)
- [x] regex smoke(`smoke-step-executor.mts` 對源碼比對段)已刪(ticket 04)
- [x] CLAUDE.md 架構節同步(ticket 04)

01–04 全數 resolved。僅 05(人工 parity)未完成 —— 見該 issue。

## 風險

1. **一次到位** — PR 期間 smoke chain 有全紅窗口,`dist*` 該期間無法打包;若同機要出 paid-beta #14 簽章證據,時程會撞(已向使用者標記)。
2. **StepStrategyHost 遷移** — host 回呼從 engine state 改綁 LoopRunState;漏接任何一個 union(capability ids / unlocked tools)會斷 cross-step resume。smoke 需覆蓋 `loadedCapabilityIds` 跨步聯集。
3. **`configure()` live-apply** — settings 更新目前打在 engine;瘦身後需確保轉發進行中的 loop 仍生效(維持現行為)。
4. **實現後確認**:`agent/loop/` 底下 true-import 生產碼(`node --experimental-strip-types`)才發現該子樹的 transitive 依賴圖(`tools/toolLoop.ts`、`hermes/promptBuilder.ts`、`capabilities/*` 等)長期依賴 bundler 式免副檔名解析,Node 原生 ESM 不支援。ticket 02、03 各自用一支一次性修復腳本(`fix-node-esm-ext.mjs`,純加法、逐一驗證後才套用)補上約 15+5 個檔案的 `.ts`/`index.ts` 副檔名,並修掉因此斷裂的既有 regex smoke。純機械變更,已用 `git diff` 逐檔核對 + 全量 smoke 覆核,但下游若還有更深的 loop 子樹(理論上不會,`agent/loop/` 已是葉端)會重演同一發現流程。

## Tickets

| # | 檔案 | Status | Blocked by |
|---|------|--------|-----------|
| 01 | issues/01-llm-transport-seam.md | 可交給代理 | — |
| 02 | issues/02-agent-loop-step-run.md | 可交給代理 | 01 |
| 03 | issues/03-loop-runner-four-patterns.md | 可交給代理 | 02 |
| 04 | issues/04-engine-adapter-slimdown.md | 可交給代理 | 03 |
| 05 | issues/05-manual-parity-merge-bar.md | 需人工處理 | 04 |
