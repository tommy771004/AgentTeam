# Task Agent 工作流、Hermes 與 Loop Engineering 整合計畫

> **狀態：** 完成（Phase 0–6 全部落地；後續僅維運與 Phase 5 CLI capability 逐項開啟）  
> **基準：** 2026-07-14 工作區；已確認 `node scripts/smoke-scenario-e2e.mjs`、`node scripts/smoke-caps.mjs`、`npx tsc -b --pretty false` 通過。  
> **範圍：** 使用者在對話中送出任務後的「開始 → 過程 → 結束」；同時涵蓋 built-in engine、外部 CLI runner、Hermes、四種 Loop、背景委派與並行 run。  
> **不在本計畫內：** 重寫 Electron IPC、移植 Hermes Python runtime、改變工具安全政策本身、預設開啟並行模式。

---

## 1. 目標與決策

### 1.1 目標

將目前「資料層可並行、部分 UI 仍單一 run」、「內建 engine 完整、CLI 語意較薄」、「lifecycle 收尾分散」的狀態，收斂成可稽核的一條任務生命週期。

完成後，每個 task agent run 必須符合以下結果：

1. 一個 `runId` 對應一份 immutable 的任務快照、一條可切換的即時呈現、一份最終結果。
2. 同時執行的不同 thread，不能互相借用 log、activity、停止按鈕、intervention 或檔案摘要。
3. 對話只會自動執行 Turn-based 或 Goal-based；Time-based 與 Proactive 必須有真實 trigger 才可執行。
4. Built-in 與 CLI 都要誠實回報自己的 Loop 能力；不支援 DoD/iterate 的 runner 不可偽裝為已完成的 Goal loop。
5. Hermes 的 history、session recall、memory、skills 與 learning 必須有明確預算及寫入時機，不能「已建立卻在 prompt 截斷時消失」。
6. Archive、learning、thread bubble、onSettled、queue drain 每個 run 各只執行一次，且有固定順序。

### 1.2 架構決策

採用一個深的 **`TaskRunCoordinator` module** 作為 task lifecycle 的唯一 seam。它以小 Interface 隱藏 capacity、queue、snapshot、runner 選擇、finalization 與 activity routing 的複雜性，讓入口與 UI 不再各自維護生命週期規則。

`agentEngine` 與 local CLI 是這個 seam 兩個真實的 **Adapter**：前者執行完整 Loop，後者回傳 externally-executed outcome。只有實際提供 Parse/Validate/Iterate 的 Adapter 可以宣稱完整 Goal loop。

### 1.3 共同語彙

| 名稱 | 定義 |
|---|---|
| **Chat turn** | 一則使用者訊息；負責 thread、bubble、busy policy。 |
| **Loop run** | 一次 built-in `agentEngine.start()`；負責 Parse、Pattern、DoD 與 Iterate。 |
| **External run** | 一次本機 CLI 執行；由 runner Adapter 描述支援能力。 |
| **Run snapshot** | `runId` 建立時固定的 objective、thread、project、attachments、settings、context 與 intent。 |
| **Run outcome** | Adapter 結束後，供 finalization 消費的唯一結果形狀。 |

---

## 2. 現況與缺口

### 2.1 已到位、應保留的能力

| 面向 | 現況 | 錨點 |
|---|---|---|
| 單一入口 | composer、slash、schedule、webhook、delegate 大致都經 `runTask` / `runExternalObjective`。 | `agent/runExternal.ts` |
| Built-in Parse / Loop | 未釘選 thread 可自動分類；LLM parser、DoD evaluator、gap-driven replan 已接線。 | `agent/engine.ts`、`parser.ts`、`replan.ts` |
| Hermes 主路徑 | FC/heuristic 有 prompt layers、memory、skill/capability、HITL、tool supervisor。 | `hermes/promptBuilder.ts`、`tools/toolLoop.ts` |
| Continue Goal | built-in Goal 失敗時保存 DoD/missing，可建立修正步驟繼續。 | `agent/continueGoal.ts`、`engine.ts` |
| 安全與 queue | per-run HITL、可持久化 queue、project pin、unattended timeout 已有基礎。 | `toolGuard.ts`、`runQueue.ts` |

### 2.2 本計畫要修復的缺口

| ID | 優先 | 缺口 | 根因 |
|---|---:|---|---|
| R1 | P0 | 並行 run 的 UI/activity/停止動作會跨 run 混線。 | state 有 `runId`，但 presentation 與 thread selection 仍偏單一 `agent` / `runActivityStore`。 |
| R2 | P0 | 對話文字可直接觸發 Time/Proactive 一次性執行。 | parser 以關鍵字分類；缺真正 schedule/event trigger 物件。 |
| R3 | P0 | CLI 被呈現為 Goal loop，實際略過 Parse、DoD、replan、capability；`continueGoal` 也未傳入 CLI prompt。 | external runner 沒有正式的 outcome capability contract。 |
| R4 | P1 | history/session recall 有預算，但最後 `extraContext` 只取前 2,000 字元。 | context 多處串接、最後才裁切，沒有 ownership 與 slot 預算。 |
| R5 | P1 | reserve、附件 materialize、queue drain、finalization 在多層重複。 | lifecycle ownership 分散於 page、`runExternal`、`runDispatch`、`agentStore`。 |
| R6 | P1 | 背景 delegate 可能留下額外 thread 與兩份 Archive。 | 背景工作同時走 `runTask` 與 synthetic archive。 |
| R7 | P2 | successful run 對 `onUserTurn()` 計數兩次；run state 未淘汰。 | learning hook 與 active state lifecycle 沒有單一 owner。 |
| R8 | P2 | `Next_State = Dispatch Webhook` 沒有 runtime consumer；文件仍同時描述 global single lock 與並行 ADR。 | Loop post-state 與文件治理未完成閉環。 |

---

## 3. 目標工作流

```text
Chat / Automation input
        │
        ▼
TaskRunCoordinator.start(request)
        │  建立 RunSnapshot、capacity / queue、單次附件處理
        ├────────────────────────────────────────────┐
        │                                            │
        ▼                                            ▼
BuiltInLoopAdapter                           ExternalRunnerAdapter
Parse → Pattern → Hermes → Tools             CLI protocol + declared capabilities
→ Validate → Iterate/Terminate               → external outcome
        └────────────────────────────────────────────┘
                              │ RunOutcome
                              ▼
                    Coordinator finalization
     thread summary / activity / archive / learning / onSettled / drain
                              │
                              ▼
                    Run presentation indexed by runId
```

### 3.1 `TaskRunCoordinator` Interface

下列是呼叫端唯一需要理解的 Interface；其餘為 module 的 Implementation 細節。

```ts
type RunHandle = { runId: string; threadId: string; queued?: boolean }

interface TaskRunCoordinator {
  start(request: TaskRunRequest): Promise<RunHandle>
  cancel(runId: string): Promise<void>
  get(runId: string): RunSnapshot | RunOutcome | null
  subscribe(runId: string, listener: RunListener): () => void
}
```

**Interface invariants**：

- `start()` 在第一次 `await` 前建立 `runId`、capacity reservation 與 `RunSnapshot`；同一 `runId` 不可再次 reservation。
- snapshot 的 project root、attachments、thread、runner、loop intent 不會受使用者之後切換 UI 影響。
- `cancel(runId)` 只取消該 run 的 engine、CLI、HITL 與 presentation。
- 每一個 terminal outcome 只可進入一次 finalization；finalization 完成後才釋放 capacity 與 drain queue。
- `subscribe()` 僅回報該 run；UI 不得以全域 selected state 推測目前 run。

### 3.2 Adapter Interface

```ts
type RunnerCapabilities = {
  parse: boolean
  validateDoD: boolean
  iterate: boolean
  continueGoal: boolean
  progressiveCapabilities: boolean
  runScopedProgress: boolean
}

interface TaskRunnerAdapter {
  capabilities: RunnerCapabilities
  execute(snapshot: RunSnapshot, emit: RunEmitter): Promise<RunOutcome>
  cancel(runId: string): Promise<void>
}
```

決策如下：

- `BuiltInLoopAdapter` = 完整能力；維持現有 `agentEngine`、Hermes、FC/heuristic/simulation 的 Implementation。
- `ExternalRunnerAdapter` 第一階段只宣告實際支援能力；UI 顯示「外部執行」，不用 `CLI returned` 偽裝成 DoD met。
- `continueGoal`、自動 replan、能力載入僅在 Adapter 宣告支援時可用。CLI 要支援前，必須把原始 DoD、missing、prior digest 以 runner 可驗證的 prompt/protocol 傳遞，並以對應 evidence 回傳。

### 3.3 Run Presentation

將 `runActivityStore` 從一份全域活動資料改為有上限的 `Map<runId, RunPresentation>`。Thread 只保存 `threadId → activeRunId` 的索引；選取 thread 時，由此選取 presentation。

`RunPresentation` 必須含：status、plan、thought、events、draft、file changes、tool calls、intervention state、terminal summary。完成後保留精簡 summary，詳細即時資料依上限淘汰；Archive 是跨 session 的耐久紀錄。

---

## 4. 分期實作計畫

### Phase 0 — 保護既有使用者與建立基線

**目的：** 在並行 UI 完整前，不擴大已知風險；將稽核情境變成可回歸的測試。

- [Ｘ] 保持 `concurrentRunsEnabled` 預設為 `false`，設定 UI 加上「實驗性：多 run 呈現尚未完成」提示，直到 Phase 1 驗收完成。
- [Ｘ] 在 `smoke-scenario-e2e.mjs` 加入兩 thread 同時開始、切換 active thread、分別取消/完成的情境。
- [Ｘ] 在 smoke source contract 加入「RunProcessFeed、InlineRunPanel 不可只讀全域 `agent` / global activity」的檢查；待 Phase 1 實作後轉綠。
- [Ｘ] 記錄 baseline：兩 built-in run、built-in + CLI、兩個 HITL ask、queue overflow、背景 delegate。

**Baseline record（2026-07-14）**：

| 情境 | 回歸證據 | 目前結果 |
|---|---|---|
| 兩個 built-in run | `smoke-scenario-e2e.mjs` · `ADR3: opt-in concurrent runs` | 通過；run identity 分離 |
| built-in + CLI | `runDispatch.ts` → `startLocalCliExecution`／`path: 'cli'` | wiring 已存在，CLI 執行需 Electron |
| 兩個 HITL ask | ADR3 scenario 的 `runId`／`threadId` assertion | 通過；各自回到來源 run |
| queue overflow | ADR3 scenario 的 `overflow should drain` assertion | 通過；slot 釋放後補跑 |
| 背景 delegate | `backgroundJobs.ts` 的 `runTask`、`sourceKind: 'delegate'`、`archiveBackgroundJob` | wiring 已存在；Archive／parent injection 受 production path 控制 |

**驗收：** 預設設定不改變既有單 run 行為；新增測試可以重現目前 R1 的失敗條件。

### Phase 1 — Run-scoped presentation 與控制（R1）

**目的：** 讓並行 run 的觀察與控制和資料層一樣，以 `runId` 隔離。

**檔案重點：**

- Modify: `src/store/runActivityStore.ts`
- Modify: `src/store/agentStore.ts`
- Modify: `src/store/threadStore.ts`
- Modify: `src/pages/ProtocolsPage.tsx`
- Modify: `src/components/{RunProcessFeed,InlineRunPanel,Layout}.tsx`
- Modify: `src/store/permissionAskStore.ts`（只在缺少 run-scoped呈現時）
- Test: `scripts/smoke-scenario-e2e.mjs`、`scripts/smoke-caps.mjs`

**工作：**

- [Ｘ] 新增 `getRunIdForThread(threadId)` 的 UI 消費路徑；`selectThread()` 或 page effect 明確選取該 thread 的 run presentation。
- [Ｘ] `RunProcessFeed`、`InlineRunPanel`、停止、continue、intervention 一律接收明確 `runId`；不可 fallback 到 `selectedRunId`。
- [Ｘ] 將 `RunActivityStore.begin/end/push` 改為 run-scoped record；CLI stream 只更新對應 record。
- [Ｘ] `runExternal` 建立 summary 時讀取 `getPresentation(runId)`，不可讀取「目前顯示中的」活動資料。
- [Ｘ] `RunActivityStore` 結束時清掉 active live state，但保留 bounded terminal digest。
- [Ｘ] `runAgentStates` 改為 bounded cache，並保留 thread → last run mapping 供 terminal selection。
- [Ｘ] 單一 modal 維持 FIFO；modal 顯示來源 thread/run，按鈕透過 request id resolver 回覆，不經全域 selected run。

**驗收：**

- Thread A/B 同時執行時，A 的 thought、tools、files、stop 不會影響 B。
- 在 B thread 看 A 的完成、切回 A，兩者都有正確各自 summary。
- A/B 都等待 HITL 時，核准順序正確回到提出 ask 的 run。
- 完成 100 次 run 後，live state 大小有固定上限。

### Phase 2 — Trigger 正確性與 Loop post-state（R2、R8）

**目的：** 將「對話任務」與「自動化 trigger」分成兩個清楚的使用情境。

**檔案重點：**

- Modify: `src/agent/parser.ts`
- Modify: `src/agent/llmParser.ts`
- Modify: `src/agent/engine.ts`
- Modify: `src/agent/runExternal.ts`
- Modify: `src/pages/ProtocolsPage.tsx`
- Modify: `src/pages/AutomationPage.tsx`
- Test: `scripts/smoke-caps.mjs`、`scripts/smoke-scenario-e2e.mjs`

**工作：**

- [Ｘ] 對話來源的 auto classifier 僅輸出 Turn-based / Goal-based；偵測到 cron/event 語意時輸出 `AutomationSuggestion`，不直接執行 Time/Proactive。
- [Ｘ] Time-based 僅由有效 ScheduledJob 到期進入；run snapshot 需含 schedule job id 與觸發時間。
- [Ｘ] Proactive 僅由已驗證的 event payload 進入；event matcher 產出 boolean predicate evidence，而不是從 objective 尋找 `when/if` 字樣。
- [Ｘ] `Next_State` 收斂為可消費的 outcome：`Halt`、`Await User Input`、`Dispatch Webhook`。未設定 webhook target 時，`Dispatch Webhook` 必須失敗並留 audit，不可靜默成功。
- [Ｘ] 計畫 bubble 顯示 trigger source 與自動／手動分類原因。

**驗收：**

- 輸入「每天 08:00 寄摘要」只出現建立排程建議，不會執行工具。
- 未帶 event evidence 的 Proactive run 被拒絕；pre-matched payload 的 action 可追溯其 matcher evidence。
- `Dispatch Webhook` 有成功 delivery 或明確 failed/halted outcome。

**Phase 2a 實作記錄（2026-07-14）：** `automationSuggestion.ts` 提供純的對話 trigger 偵測與 consent-first 文案；`runExternal` 在 capacity reservation 前攔截 composer/slash 的排程／事件語意，僅建立建議 bubble，不進 engine 或 tools。LLM auto plan 與 heuristic classifier 均只接受 Turn/Goal；明確釘選及已驗證 automation trigger 仍可 force Time/Proactive。回歸證據：`smoke.mjs`、`smoke-caps.mjs`、`smoke-prod-modules.mts`。

**Phase 2b 實作記錄（2026-07-14）：** `claimDueJobs()` 回傳的 claimed job 由 `createScheduleTriggerSnapshot()` 固化 `jobId`、`scheduleKind` 與 `triggeredAt`；`runExternal` 在 capacity reservation 前拒絕缺少有效 schedule trigger 的所有 Time-based request，engine 另做 defense-in-depth 驗證。snapshot 透過 queue persistence、builtin/CLI run state 與 archive 保留；回歸證據：`smoke-caps.mjs` Phase 2b、`smoke-prod-modules.mts` claimed-job validation、build/smoke 全套。

**Phase 2c 實作記錄（2026-07-14）：** 新增深 module `eventMatcher.ts`，以 normalized event payload 對 `source`、`subjectContains`、`hasAttachment`、`keyword` 產出可序列化且可驗證的 boolean predicate evidence；Webhook 與 event simulator 只將 matcher evidence 傳入 `runExternal`，`runExternal` 在 capacity reservation 前拒絕無效 Proactive trigger，engine 再做 defense-in-depth 驗證。evidence 會沿 queue、builtin/CLI state、archive 與 retry 保留；Proactive engine 不再解析 objective 的 `when/if` 字樣。回歸證據：`smoke-caps.mjs` Phase 2c、`smoke-prod-modules.mts` matcher validation、build/smoke 全套。

**Phase 2d 實作記錄（2026-07-14）：** 新增深 module `outcomeDispatcher.ts`，將 `Halt`、`Await User Input`、`Dispatch Webhook` 統一消費成 `PostStateOutcome`；outbound webhook target 僅允許 http/https，缺 target、非 2xx 或 transport exception 均明確留下 failed audit 並使 run 失敗。builtin/CLI 在 archive 前各只消費一次 outcome，結果沿 run state、archive、thread audit 與 queue 的 runtime override 保留；Electron 透過 main-process webhook adapter 傳送，browser 可 fallback 到 fetch。Loop parser/LLM schema 也支援 `Dispatch Webhook`，Settings 新增選填 target。回歸證據：`smoke-caps.mjs` Phase 2d、`smoke-prod-modules.mts` 三種 outcome/202/503 validation、scenario smoke、build 與 marketplace E2E。

**Phase 2e 實作記錄（2026-07-14）：** `parser.ts` 新增 `resolvePlanBubbleMetadata()`，統一產生 `Trigger source` 與 `分類原因`；對話／Slash 顯示 auto classifier，手動 retry 顯示使用者指定，ScheduledJob、Webhook/event matcher、Telegram、delegate 與 queue drain 顯示對應 adapter／驗證證據。`runExternal` 將 normalized metadata 傳入 engine，`formatPlanBubble` 即使由較低層直接呼叫也會補齊預設欄位；queue persistence 同步保留自訂來源與分類原因。回歸證據：production modules 15/15、capability smoke 63/63、完整 smoke（含 16 scenario E2E 與 marketplace E2E）、build 與 oxlint。

### Phase 3 — 收斂 lifecycle ownership（R5、R6）

**目的：** 把目前散落的責任移到 `TaskRunCoordinator`，提升 locality 並消除重複副作用。

**檔案重點：**

- Create: `src/agent/taskRunCoordinator.ts`
- Modify: `src/agent/{runExternal,runDispatch,runQueue}.ts`
- Modify: `src/store/agentStore.ts`
- Modify: `src/pages/ProtocolsPage.tsx`、`src/hooks/useSlashExecutor.ts`、`src/App.tsx`
- Modify: `src/agent/hermes/backgroundJobs.ts`
- Test: `scripts/smoke-scenario-e2e.mjs`

**工作：**

- [Ｘ] 將 `runTask` 保留為相容入口，但改為 coordinator 的薄 adapter；新 code 不再直接呼叫 `runExternalObjective`。
- [Ｘ] 在 coordinator 只做一次 capacity check/reserve、附件 normalize/materialize/hydrate、thread bind、beforeRun hook。
- [Ｘ] `runDispatch` 只負責由 snapshot 選擇 runner、組 runner context，不再自行管理 capacity 或附件 I/O。
- [Ｘ] 建立唯一 finalization 順序：Adapter terminal outcome → thread summary/bubble → afterRun hook → Archive → Learning → onSettled → release capacity → queue drain。
- [Ｘ] 只有 finalization 可以 drain；stop 只改變指定 run 的終止狀態，等待 finalization 處理 drain。
- [Ｘ] 背景 delegate 選擇一種耐久紀錄：若已走 coordinator，就使用其 Archive；synthetic job record 改為連結 metadata，不再新增第二筆 execution Archive。
- [Ｘ] 背景 delegate 不建立可見的獨立普通 thread；以 parent thread 的 run summary / background job record 呈現，必要時另設 hidden worker thread 類型。

**Phase 3 item 1 實作記錄（2026-07-14）：** 新增 `taskRunCoordinator.ts` 作為 canonical ingress；`normalizeTaskRunInput()` 統一處理入口 objective，`runTask()`／`coordinateTaskRun()` 將 legacy `runExternalObjective` 隱藏在 coordinator implementation 後。`runExternal.ts` 的 `runTask` 保留為相容薄 adapter；App、store、queue drain、頁面、slash、SubDesign 與 background delegate 均改走 coordinator，避免新 code 直接呼叫 legacy implementation。回歸證據：typecheck、capability smoke 64/64、production modules 16/16、完整 smoke、scenario E2E、marketplace E2E、build 與 oxlint。

**Phase 3 item 2 實作記錄（2026-07-14）：** coordinator 新增單一所有者 API：`prepareRunAttachments`（`persist`/`hydrate` 分相，各最多一次）、`checkRunCapacity`／`reserveRunCapacity`／`releaseRunCapacity`、`bindRunThread`、`evaluateBeforeRunHooks`。`runExternalObjective` 改為呼叫上述 helpers，不再本機 `materialize`／`hydrate`／`canStartRun`／`reserveRun`／`bindRun`／inline beforeRun。`runDispatch` 同步移除 capacity check 與附件 I/O。回歸證據：typecheck、capability smoke 65/65、production modules 16/16、完整 smoke、build、oxlint。

**Phase 3 item 3 實作記錄（2026-07-14）：** 新增 `RunDispatchSnapshot` 與 `buildRunDispatchSnapshot()`；snapshot 固化 `runId`／`threadId`／`objective`／`runner`／`forceLoopType`／attachments／overrides，並設 `deferFinalization: true`。`dispatchThreadTask(snapshot)` 只選 runner、組 CLI／builtin context，不再 capacity／附件 I/O。回歸證據：capability smoke contract「Phase 3 item 3」。

**Phase 3 item 4/5 實作記錄（2026-07-14）：** `finalizeTaskRun()` 統一順序：thread summary/bubble → afterRun → Archive → onSettled → release capacity → drain。Adapter（`startExecution`／CLI）在 `deferFinalization` 時跳過 Archive／release／drain。`stopExecution` 只終止 run、不再 drain。Learning 仍在 Adapter 內（engine／CLI 成功路徑）以保持既有語意。回歸證據：capability smoke contract「Phase 3 item 4/5」、scenario E2E。

**Phase 3 item 6/7 實作記錄（2026-07-14）：** 背景委派 `preferRunTask` 路徑寫入 `job.archiveRunId` 並跳過第二筆 synthetic Archive（link-only + parent inject）。`workerThread: true` 建立 `Thread.hidden` worker，sidebar 過濾、`createThread`／`bindRunThread` 不搶 active。Nested FC 路徑（`preferRunTask: false`）仍可寫單一 synthetic Archive。回歸證據：typecheck、capability smoke 68/68（含 item 3–7 contracts）、scenario E2E 16/16、production modules 16/16、完整 smoke（marketplace E2E）、build、oxlint 0 errors。

**Phase 3 migration completion（2026-07-15）：** 移除 `runExternal.ts`、`runExternalObjective` 與 unsnapshotted runner overload。`taskRunCoordinator.runTask` 成為唯一 public seam，空白 request 在載入 renderer/store runtime 前拒絕；共享 contract 由 `taskRunContracts.ts` 擁有並由 coordinator re-export。內部依賴固定單向為 coordinator → execution → lifecycle support / runner adapter；queue re-entry 與 OpenCode session sync 以由上往下傳入的 callback 保持 finalization locality，不再有 support → execution reverse import。

**驗收：**

- 每個 run 只有一次 reservation、一次附件寫入、一次 Archive、一次 onSettled、一次 queue drain。
- queue 中的 schedule job 仍可在 app restart 後回寫結果。
- background delegate 完成時，parent thread 最多得到一則 completion turn，Records 只有一筆對應 execution。

### Phase 4 — Hermes context 與 learning 閉環（R4、R7）

**目的：** 將 prompt 層的字元預算從「串接後截斷」轉為可檢查的 ContextPacket，確保召回真的送進模型。

**檔案重點：**

- Create: `src/agent/hermes/contextPacket.ts`
- Modify: `src/agent/hermes/promptBuilder.ts`
- Modify: `src/agent/{runDispatch,engine,chatHistory}.ts`
- Modify: `src/agent/hermes/{memory,sessionSearch,learning}.ts`
- Test: `scripts/smoke-caps.mjs`

**工作：**

- [Ｘ] 建立 `ContextPacket`，分配 stable identity、project guidance、current objective、recent chat、session recall、step evidence、memory/failure lessons、plugin fragments 的固定 slot 與優先序。
- [Ｘ] 移除 prompt builder 對整段 `extraContext.slice(0, 2000)` 的最後裁切；改由 packet 在個別 slot 截斷，並保留 `includedChars` diagnostics。
- [Ｘ] session recall 只帶 top-k evidence 摘要；若超出預算，優先保留同 objective 的 failure lesson 與最新 user turn。
- [Ｘ] `learningLoop.onUserTurn()` 僅在 coordinator 接受一個 user-initiated chat turn 時呼叫；`onGoalSuccess()` 不再增加 turn counter。
- [Ｘ] `memoryStore` 與 session search 針對繁中增加 token/bigram scoring；failure lesson 帶明確 tool/strategy tag，供 packet 精準召回。
- [Ｘ] temporary chat 不建立 memory write、不讀取 session recall，並在 packet diagnostics 顯示原因。

**Phase 4 實作記錄（2026-07-14）：** 新增 `hermes/contextPacket.ts`（固定 slot／優先序／總預算／`includedChars` diagnostics、`formatSessionRecallBlock` failure-first top-k）。`promptBuilder` 以 packet 組裝 context，移除整段 extraContext 最後 2000 字裁切。`engine` 將 session recall 獨立為 `sessionRecallBlock` 並寫入 packet；日誌輸出 `formatPacketDiagnostics`。`scoreQueryText`（ASCII + 繁中 bigram）共用給 memory／sessionSearch。`onGoalFailure` 寫入 `tool:`／`strategy:` tags；`onUserTurn` 僅 `runExternal` 在 composer／slash／retry admit 時呼叫，`onGoalSuccess` 與 engine 不再計 turn。temporary 路徑 skip memory／recall 並在 diagnostics notes 標示原因。回歸證據：typecheck、capability smoke 69/69、production modules 17/17（含 ContextPacket 純函式）、scenario E2E 16/16、完整 smoke（marketplace）、build、oxlint 0 errors。

**驗收：**

- 長 history + project guidance + session recall 下，測試可證明 recall 或 failure lesson 出現在 FC context，而不是只出現在 engine log。
- 每五個使用者 chat turn 只產生一次 memory nudge；成功與失敗 run 計數一致。
- ContextPacket 總長度受限且每個 slot 的保留/丟棄可從 trace 檢查。

### Phase 5 — External runner 語意與 continue goal（R3）

**目的：** 用 Adapter capability 宣告真實行為，先消除不誠實的 UX，再逐步提升 CLI 互通性。

**檔案重點：**

- Create: `src/agent/runners/{types,builtinAdapter,localCliAdapter}.ts`
- Modify: `src/agent/{runDispatch,localCliRun}.ts`
- Modify: `src/store/agentStore.ts`
- Modify: `src/components/{InlineRunPanel,RunProcessFeed}.tsx`
- Test: `scripts/smoke-scenario-e2e.mjs`、`scripts/smoke-caps.mjs`

**工作：**

- [Ｘ] 將 builtin 與 CLI outcome 正規化為同一結果形狀，但保留 `executionKind: 'loop' | 'external'`。
- [Ｘ] CLI run 的 UI 顯示「外部 CLI 執行」與其可用能力，不顯示未實施的 DoD iteration/progressive capability。
- [Ｘ] 未支援 `continueGoal` 的 CLI 禁用「補齊缺口繼續」；保留原 snapshot 並說明需改用 built-in 或重新開啟外部任務。
- [Ｘ] 若要支援 CLI continueGoal，先定義可測試的 prompt contract：objective、DoD、missing、prior digest、project root、approval mode 均需顯性傳遞；外部結果需提供可驗證 evidence。
- [Ｘ] 只有該 contract 與 smoke fixture 完成後，才開啟 CLI 的 `validateDoD/iterate/continueGoal` capability。

**Phase 5 實作記錄（2026-07-14）：** 新增 `agent/runners/types.ts`（`RunnerCapabilities`、`executionKind`、`BUILTIN_*`／`EXTERNAL_CLI_*` matrix、`EXTERNAL_CLI_DOD_LABEL`、`formatCliContinueGoalPrompt`／`isCompleteCliContinueGoalContract`）。CLI outcome 與 builtin 共用 `AgentState`／`DispatchResult`，但標 `executionKind: 'external'` 且 DoD 改為誠實標籤（移除 `CLI returned`）。`InlineRunPanel` 顯示「外部 CLI 執行」與能力摘要、隱藏 progressive capability 列表；`continueGoal` 僅在 `capabilities.continueGoal` 時可按，否則保留 snapshot 並提示切 builtin。`runExternal` 對不支援的 runner 丟棄 continue resume 並 bubble 說明。CLI continueGoal 能力維持 false；prompt contract 可測但未開啟。回歸證據：typecheck、capability smoke 70/70、production modules 18/18、scenario E2E 16/16、完整 smoke（marketplace）、build、oxlint 0 errors。

**驗收：**

- CLI 成功不再把 `CLI returned` 表示為 DoD met。
- CLI continuation 不會靜默忽略 missing；UI 要麼禁用、要麼能在 prompt fixture 中看見完整 corrective context。
- built-in/CLI 都有 run-scoped cancel 與正確 terminal summary。

### Phase 6 — 文件、設定與 rollout（R8）

**檔案重點：**

- Modify: `AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`
- Modify: `docs/CONVERSATION_LOOP_HERMES_FLOW.md`
- Modify: `docs/adr/0003-concurrent-run-lock-removal.md`（實作狀態）
- Create or remove: `RTK.md` reference

**工作：**

- [Ｘ] 將「global single run」描述改為「預設單 run、可設定上限的 per-run concurrency」。
- [Ｘ] 明確記錄 Time/Proactive 只由 automation trigger 執行的規則。
- [Ｘ] 記錄 runner capability matrix 與 CLI 的語意差異。
- [Ｘ] `AGENTS.md` 的 `@RTK.md` 必須指向已存在的檔案；若沒有此規範，移除引用並寫明替代來源。
- [Ｘ] 將本計畫與完成項目回鏈到既有 conversation/loop/Hermes 文件，避免新一輪文件漂移。

**Phase 6 實作記錄（2026-07-14）：** `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` 改寫為 coordinator 管線、預設單 run + opt-in 並行上限、Time/Proactive trigger 規則、runner matrix（builtin vs external）。倉庫**不**提供 `RTK.md`——明確寫入「agent 操作指引以 AGENTS/CLAUDE/CONTEXT/docs 為準」。`docs/CONVERSATION_LOOP_HERMES_FLOW.md` 對齊 `taskRunCoordinator` + ContextPacket + finalize 順序並回鏈本計畫；`docs/adr/0003-concurrent-run-lock-removal.md` 標 implemented + 產品規則；`docs/WORKFLOW_AUDIT.md` 全景圖更新。回歸證據：capability smoke 71/71（含 Phase 6 docs contract）、完整 smoke（scenario + marketplace）、production modules。

---

## 5. 責任歸屬表

| 模組 | 唯一責任 | 不應再承擔 |
|---|---|---|
| `TaskRunCoordinator` | snapshot、capacity、queue、lifecycle hooks、finalization、terminal order | Loop 內部推理與工具細節 |
| `runDispatch` | 依 snapshot 選擇 Adapter、組 runner context | reserve、thread bubble、queue drain |
| `BuiltInLoopAdapter` | Parse、Pattern、Hermes、tools、DoD、replan | Archive、thread summary、queue drain |
| `ExternalRunnerAdapter` | 呼叫 CLI、轉換 stream/outcome、宣告 capabilities | 偽造 Loop validation |
| `RunPresentationStore` | `runId` 對應的即時/精簡歷史呈現 | 決定任務是否可開始 |
| `threadStore` | conversation persistence 與 thread → run 索引 | 保存另一個 run 的即時事件 |
| `learningLoop` | 將明確 outcome 轉為 skill/memory learning | 推測 user turn 數量 |
| `backgroundJobs` | job metadata 與通知 | 再寫一份 execution Archive |

這個分工的 deletion test：若移除 coordinator，capacity、queue、snapshot、finalization 的複雜度會重新散回所有入口，因此它能提供足夠 depth、leverage 與 locality。

---

## 6. 測試與驗收矩陣

| 情境 | 必要斷言 | 位置 |
|---|---|---|
| 兩個並行 built-in run | 事件、file summary、cancel、HITL 均保有正確 runId/threadId | `smoke-scenario-e2e.mjs` |
| built-in + CLI | UI 與 terminal outcome 各自正確；CLI 不宣稱內建 DoD | scenario + source contract |
| queue overflow | 只補跑一次、onSettled 一次、schedule result 可回寫 | scenario |
| attachments | 一次 materialize；queue persistence 只保留安全 filePath | scenario + source contract |
| chat automation 語句 | 產生 automation suggestion，不可執行工具 | pure parser test |
| pre-matched event | matcher evidence 存入 run trace；未 match 不執行 | scenario |
| context budget | session recall/memory failure lesson 被保留或有明確 dropped reason | pure packet test |
| learning | N 個 user turns = floor(N/5) 次 nudge；成功不重複計數 | pure learning test |
| background delegate | 一個 execution archive、一則 parent completion | scenario |
| runner continuation | capability 不支援時 disabled；支援時完整 corrective context 可見 | fixture test |

每個 phase 最少執行：

```bash
cd app
npx tsc -b --pretty false
node scripts/smoke-scenario-e2e.mjs
node scripts/smoke-caps.mjs
```

合併前執行完整驗證：

```bash
cd app
npm run smoke
npm run build
npx oxlint src
```

---

## 7. Rollout 與回退

1. Phase 1 前，並行開關維持預設關閉；不得因本計畫自動遷移既有使用者設定。
2. Phase 1 達標後，以內部／opt-in 方式開啟 2-run cap；先觀察 Archive、HITL timeout、renderer memory 與 queue metrics。
3. Phase 2 變更對話 Time/Proactive 行為前，提供 automation draft 提示，避免使用者以為排程語意被忽略。
4. CLI capability matrix 先採保守 false；有 runner-specific fixture 才逐項開啟。
5. 若 coordinator 出現 terminal state 問題，保留 `runTask` 相容入口可切回既有 built-in 單 run 路徑；不得同時運行兩份 finalizer。

---

## 8. 完成定義（Definition of Done）

- [Ｘ] 任一 task agent run 從 prompt 提交到 terminal outcome 都由 coordinator trace 到同一 `runId`。
- [Ｘ] 兩個並行 thread 的 UI、activity、HITL、cancel、summary 完全隔離，並有自動測試。
- [Ｘ] 對話不會以純文字觸發假的 Time/Proactive execution。
- [Ｘ] CLI 的 Loop/continueGoal 能力在 UI 與 outcome 中誠實揭露。
- [Ｘ] history、session recall、memory、step evidence 由 ContextPacket 在可觀測預算內組裝。
- [Ｘ] 每個 run 對 Archive、Learning、onSettled、queue drain 都只產生一次副作用。
- [Ｘ] 背景 delegate 不重複 Archive、不新增無意義 thread。
- [Ｘ] `Next_State` 的每個列舉值都有可消費的 runtime 行為或被移除。
- [Ｘ] `AGENTS.md`、`CLAUDE.md`、ADR、RTK reference 與實作一致。
- [Ｘ] 完整 smoke、build、lint 均通過。
