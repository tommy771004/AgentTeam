## 結論

這篇論文很適合套用到 `AgentTeam`，但重點不是再增加一個向量資料庫或對話摘要器，而是把「記憶」升級成 **Harness 的控制層**：

> 已驗證的任務狀態 → 依當下狀態選 Skill → 執行工具 → 用環境證據更新狀態 → 從結構化失敗中改善 Skill Memory。

我檢查的是 `AgentTeam/main` commit [`42d4e7`]你的 repo 已具備大部分基礎設施，但還缺論文最關鍵的「Verified Working Memory 控制迴路」。

## 論文真正提出的機制

Recuris 將可演化的 Skill Memory 定義成：

$$
\mathcal M_k=(\mathcal E_k,\mathcal W_k,\rho_k,\mathcal C_k)
$$

* \(\mathcal E\)：Experiential Memory，可重用的 Skills。
* \(\mathcal W\)：Working Memory schema 與狀態更新規則。
* \(\rho\)：何時、依什麼條件載入哪個 Skill。
* \(\mathcal C\)：判斷 observation 是否足以證明目標完成的 Checkers。

單一任務內不是拿完整聊天紀錄搜尋記憶，而是：

$$
w_t \rightarrow Skill選擇 \rightarrow Tool執行 \rightarrow Evidence檢查 \rightarrow w_{t+1}
$$

跨任務則從結構化 trace 定位問題屬於 \(\mathcal E/\mathcal W/\rho/\mathcal C\) 哪一層，只修改該元件，通過 held-out regression gate 後才啟用。[論文方法與實驗](https://arxiv.org/html/2608.24876v1)

值得注意的是，把整個 Skill library 一直放在 context，反而比 Recuris 多 3,111 個首輪 prompt tokens、成功率低 18 個百分點、每次成功成本高 46%。因此這不是「塞更多記憶」，而是「在正確事件載入正確的一小段記憶」。

## AgentTeam 現況對照

| Recuris 元件                         | AgentTeam 已有能力                                                                     | 主要缺口                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Experiential Memory \(\mathcal E\) | Host-owned `SKILL.md`、pin/archive、resource snapshot、digest                         | Skill 可被覆寫，還不是不可變、可回溯的版本化 package                                           |
| Working Memory \(\mathcal W\)      | Compaction manifest 已有 objective、constraints、pending work、errors、completed effects | 只在壓縮時從 transcript 用 regex 推導；不是每一步持續更新的 goal ledger                         |
| Invocation Policy \(\rho\)         | `matchForObjective`、intent preload、Pi `<available_skills>`                         | 主要根據初始 objective，或交給模型自己讀全 Skill catalog；不是依當前未完成目標與 tool draft             |
| Checkers \(\mathcal C\)            | ADR-0048 execution evidence、Host tool result、side-effect evidence                  | 缺少 goal-specific completion predicate；自訂 DoD 目前有非空 assistant output 就可能判定成功 |
| Structured Trace \(\Gamma\)        | Turn Record 已記錄 reasoning、tool call/result、approval、compaction、memory recall       | 未記錄 \(w_t,E_t,\widetilde w,c_t,w_{t+1}\)，所以無法準確區分是狀態、Skill、調用時機或 Checker 壞掉 |
| Recursive Evolution                | success skill draft、failure lesson、dream consolidation                             | 仍是成功/失敗摘要，沒有 component-level localization 與 candidate package               |
| Validation Gate                    | `evaluationHarness.ts`、journal、artifact score                                      | 現在是 3 個 smoke tasks、LLM 關閉，不足以作為 Skill Memory regression gate               |

目前 Pi 在 run 開始時直接用原始 prompt 召回 durable memory，然後才進入 orchestration；迭代期間沒有因 Working State 改變而重新召回。[piHostProtocol.ts](electron/piHostProtocol.ts#L2881-L2911)

Skill 方面則把可見 Skills 放入 `<available_skills>`，由模型決定是否讀取完整檔案。[Pi skills loader](vendor/pi/packages/coding-agent/src/core/skills.ts#L338-L359) 這正是論文拿來對比的 model-controlled invocation。

最有價值的既有資產是 [Turn Record](app/src/agent/turnRecord.ts)：它已經區分 user/model/host，並記錄可信 tool result。這讓 AgentTeam 不需要重做 logging，只要把它擴充成 Recuris trace。

## 建議的 AgentTeam Harness 架構

### 1. 建立真正的 Working State

新增 Host-owned `piWorkingMemory.ts`：

```ts
type GoalStatus = 'pending' | 'done' | 'blocked'

type EvidenceRef = {
  seq: number
  tool?: string
  callId?: string
  receiptDigest?: string
}

type WorkingGoal = {
  id: string
  description: string
  status: GoalStatus
  evidence: EvidenceRef[]
  blocker?: string
  assignedSessionId?: string
}

type WorkingState = {
  schemaVersion: 1
  runId: string
  revision: number
  objective: string
  constraints: string[]
  goals: WorkingGoal[]
}
```

現有 [CompactionManifest](app/electron/piSessionContext.ts#L211-L271) 應改成由 Working State 投影產生，而不是再從 transcript regex 猜一次。

這能確保 compaction 前後、resume、renderer reload 都保留相同的任務狀態。

### 2. 改成事件式 Skill Invocation

最適合的第一個 trigger 是 `tool_call`：

1. 模型草擬 `write/edit/bash/GitHub mutation`。
2. Harness 暫不執行。
3. 使用 `toolName + pending goals + blocker + constraints` 查詢 Skill Memory。
4. 注入最多一至兩個 Skill。
5. 回傳 synthetic `not-executed` result，要求模型依 Skill 重新起草呼叫。
6. 第二次通過 idempotency key 後才真正執行。

Pi 已支援可以 block 的 `tool_call` extension hook，所以不必改寫整個 Pi Core。[Pi extension hook](vendor/pi/packages/coding-agent/docs/extensions.md#L751-L779)

要特別處理 parallel sibling tool calls：只要同一批有 state-changing call，就應先完成所有 Skill preflight，避免一個被攔截、另一個卻已並行寫入。

### 3. 用 Checker 提交狀態，不相信模型宣稱

目前 AgentTeam 的 ADR-0048 已是很好的底座：模型不能自行製造 execution evidence。[ADR-0048](docs/adr/0048-model-cannot-manufacture-execution-evidence.md)

再往上增加：

```ts
checker.check({
  beforeState,
  proposedPatch,
  toolCall,
  hostResult,
  sideEffectEvidence
})
```

例如：

* `workspace_write`：成功 receipt + readback hash 或 diff 才能關閉檔案目標。
* `bash` exit code 0：只能證明命令成功，不能直接證明整個 goal 完成。
* 子 Agent 回覆「完成」：只是 observation，必須附 artifact/tool evidence。
* 只有對話上的「好的，已處理」：不能將 goal 標成 done。

目前自訂 DoD 的 fallback 只是檢查 assistant output 是否非空，應由這套 checker 取代。[piHostRun.ts](app/src/agent/piHostRun.ts#L212-L224)

### 4. 擴充 Turn Record，而不是建立第二條 timeline

建議將 Turn Record 升到 v3，新增：

* `working-state`
* `skill-invocation`
* `state-proposal`
* `state-check`
* `memory-package`

然後從 Turn Record 投影出論文的：

$$
\Gamma=\{w_t,E_t,a_t,o_t,\widetilde w_{t+1},c_t,w_{t+1}\}
$$

每個 Skill invocation 應保存：

* package revision
* skill id/version/digest
* trigger event
* retrieval key
* 對應 goal IDs
* 是否真正被執行路徑使用

這也能偵測「Skill 本身正確，但 invocation policy 完全沒有命中」的 broken binding。

### 5. 將四元件包成版本化 Memory-Control Package

```ts
type MemoryControlPackage = {
  id: string
  revision: number
  parentRevision?: number
  experientialSkills: SkillVersionRef[]
  workingMemorySpec: WorkingMemorySpec
  invocationPolicy: InvocationPolicySpec
  checkers: CheckerSpec[]
  status: 'candidate' | 'active' | 'rejected'
}
```

Meta-Agent 只能輸出 schema-valid JSON Patch，不能修改任意 TypeScript 或整個 harness。

例如診斷為：

* 遺漏操作流程 → patch \(\mathcal E\)
* 沒記住尚未完成的檔案 → patch \(\mathcal W\)
* Skill 載入太晚／沒命中 → patch \(\rho\)
* 有 receipt 卻保持 pending → patch \(\mathcal C\)

未被診斷的元件 digest 必須完全不變。

## Multi-agent 特別處理

對 AgentTeam 而言，Working State 應只有一個 Host authority：

* Manager 持有 run-wide goal ledger。
* Analyzer/Writer/Delegate 只取得自己 goal 的唯讀 snapshot。
* 子 Agent 回傳 evidence references，不能直接把父 goal 改成 done。
* 父 Host checker 驗證後才以 CAS revision 提交。
* 兩個並行 Agent 若使用舊 revision 更新，拒絕或 rebase，避免互相覆蓋。

這會比讓每個 Agent 各自保存一份「目前進度摘要」可靠很多。

## 建議實作順序

1. **Verified Working State MVP**

   * 建立 goal ledger。
   * Turn Record 新增 state/checker entries。
   * compaction/resume 從 WM 還原。
   * 暫時不做自我演化。

2. **State-grounded Skill Invocation**

   * 在 Pi `tool_call` hook 攔截 state-changing calls。
   * 每次只注入 top-1 Skill。
   * 量測 invocation precision、reach、prompt tokens。

3. **版本化 Memory-Control Package**

   * Skill 不可變版本與 digest。
   * candidate/active/rejected lineage。
   * 合併目前分散的 Host learning 與 renderer `learningLoop` authority。

4. **Validation Gate**

   * 將現有 [evaluationHarness.ts](app/src/agent/evaluationHarness.ts) 擴充為 `evolve/dev/test`。
   * Candidate 必須修復來源失敗，且不能破壞既有成功 anchor tasks。
   * 同時比較 task success、false-done、required-action recall、tokens/success。

5. **最後才開啟 Meta-Agent 自動 patch**

   * 預設只產生 candidate。
   * 通過 gate 才 activate。
   * 支援一鍵 rollback。

最值得先做的第一個 PR 是「Verified Working State + Turn Record v3」。不要先做 Meta-Agent 或自動改 Skill；論文自己的 ablation 也顯示，真正支撐長任務的是 verified WM 與 invocation control，而不只是多一批 Skills。

另外，你之前規劃的 deterministic reducer 可以放在 `tool/worker observation → checker` 之間，負責壓縮大量子 Agent 輸出；但 execution receipt、goal ID、call ID 與 checker 所需欄位必須保留原始值，完整 raw evidence 仍留在 Turn Record。這樣 reducer 解決 I/O token，Recuris 解決「現在究竟該記住什麼、呼叫什麼、什麼才算完成」。
