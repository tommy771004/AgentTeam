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
2. **Consent-first 執行點** — `LoopRequest` 為 discriminated union:`pattern:'time'` 必帶 `ScheduledJobClaim`、`'proactive'` 必帶 `EventEvidence`(無證據呼叫過不了 tsc);`runLoop` 入口做唯一 fail-closed 斷言。發證機關(scheduler claim / eventMatcher)不動。
3. **State 擁有權** — Loop Runner 持有 plain `LoopRunState`;唯一側效出口 `deps.publish(snapshot)`;結果由回傳值 `{ state, outcome }` 承載。engine adapter 是唯一 production 訂閱者。
4. **HITL** — 單一 `deps.ask(req): Promise<AskDecision>` port;逾時與 auto-deny 政策(unattended 45s / 互動 90s / safety 900s)在 Loop Runner 內部(產品規則要可測);intervention 狀態同步進 published snapshot 供 UI 顯示。
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
  ask: (req: AskRequest) => Promise<AskDecision>     // HITL;逾時政策在 runner 內
  // 其餘依賴(settings 解析、能力組裝)沿用現有 import;不擴 deps
}

type LoopResult = { state: LoopRunState; outcome: LoopOutcome }
```

```ts
// agent/llm.ts
type LlmTransport = (req: ChatRequest) => Promise<ChatResponse>
export function setLlmTransport(t?: LlmTransport): void   // undefined = 還原預設
// chatCompletionWithTools 內部順序:sanitize → gate → transport(req)
```

## Merge bar(全部必勾才可合併)

- [ ] smoke: stepRun 三路徑(FC / heuristic / simulation)以 scripted transport 跑完整一步
- [ ] smoke: Goal loop DoD fail → replan → met 全循環
- [ ] smoke: ask 逾時 → auto-deny(unattended 45s 路徑)
- [ ] smoke: time / proactive 無 claim / evidence → 入口 refused(fail-closed)
- [ ] smoke: publish snapshot 序列形狀不變(steps/subAgents/toolCalls/status 遞進)
- [ ] 既有 smoke chain 全綠(`npm run smoke`)
- [ ] 手動:dev app 四 pattern 各跑一次 + 一次真 intervention 解鎖(ticket 05)
- [ ] drift guard:production 碼(engine 之外)import `agent/loop` → build fail
- [ ] regex smoke(`smoke-step-executor.mts` 對源碼比對段)於 PR 尾端刪除
- [ ] CLAUDE.md 架構節同步(engine 描述、step 路徑描述)

## 風險

1. **一次到位** — PR 期間 smoke chain 有全紅窗口,`dist*` 該期間無法打包;若同機要出 paid-beta #14 簽章證據,時程會撞(已向使用者標記)。
2. **StepStrategyHost 遷移** — host 回呼從 engine state 改綁 LoopRunState;漏接任何一個 union(capability ids / unlocked tools)會斷 cross-step resume。smoke 需覆蓋 `loadedCapabilityIds` 跨步聯集。
3. **`configure()` live-apply** — settings 更新目前打在 engine;瘦身後需確保轉發進行中的 loop 仍生效(維持現行為)。

## Tickets

| # | 檔案 | Status | Blocked by |
|---|------|--------|-----------|
| 01 | issues/01-llm-transport-seam.md | 可交給代理 | — |
| 02 | issues/02-agent-loop-step-run.md | 可交給代理 | 01 |
| 03 | issues/03-loop-runner-four-patterns.md | 可交給代理 | 02 |
| 04 | issues/04-engine-adapter-slimdown.md | 可交給代理 | 03 |
| 05 | issues/05-manual-parity-merge-bar.md | 需人工處理 | 04 |
