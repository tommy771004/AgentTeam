# SubAgents AI ↔ DeepSeek `deepseek-harness` 對照分析

> 依據：`deepseek-ai/deepseek-harness` @ `b150a55`（release/dsh-0.1.1-rc.2）淺 clone 逐份讀 `docs/architecture.md`、`docs/agent-lifecycle.md`、`docs/subsystems/{core,llm-streaming,compaction,jobs,goal,spill,token-meter,session-projection,client-modules,web}.md`、`docs/cookbook/adding-a-{tool,conversation-node}.md`、`packages/client/ui-*/README.md`、`packages/guard/*`；對照本專案 `app/src/agent/**`、`app/electron/pi*.ts`、`app/src/store/**`。
>
> 定位差異先講清楚：dsh 是 **pnpm monorepo + 自帶 Cordis plugin kernel 的 agent harness**，交付面是 Web 應用（瀏覽器端本身也是外掛表）、headless 一次性 runner、ACP server、TS/Python SDK；本專案是 **Electron 桌面產品 + Pi Core utility process**，交付面是一個裝得起來的 app。所以「他們有我們沒有」不等於缺陷，但**方法論**的差距是真的。

---

## 1. 長時間任務的 Request / Response 處理

### dsh：一切都掛在 turn/step 骨架上，而骨架本身是可替換的外掛

`step` = 一次 model request 加上它引發的工具；`turn` = 零到多個 step，在第一份輸入被 claim 前開啟、在沒有任何欠債時關閉。長任務的每一種狀況都對應骨架上的一個具名擴充點：

| 議題 | dsh 的機制 | 關鍵設計 |
|---|---|---|
| 中途插話 | 一個 inbox 三種投遞：`followup()` 排新 turn、`steer()` 進最近的 step 邊界、`inject()` 不喚醒 driver、等下次 pre-step 才被 claim | 三種語意分開，不是「都塞進佇列」 |
| 輸入准入 | `agent/pre-step` waterfall，listener 可改寫或整批拒絕 | 被拒的 claim **仍然關掉一個 durable turn**，log 記得下這次嘗試 |
| 取消 | `cancel(cause, { keepInbox })`，第一個 cause 勝；`whenIdle()` 等整個 agent 收斂；`runMaintenance()` 佔用真正的 idle 相位 | 取消後才送達的喚醒輸入排到下一個 turn，`disposed` 則停在原地 |
| Provider 卡住 | transport 層 `streamIdleTimeoutMs`（預設 5 分鐘）watchdog，**只在 iterator `next()` 未決時 arm**，用同一個 signal 貫穿整個 request | 自己的到期映射成 `TIMEOUT`，更早的呼叫端中止仍保持 `ABORTED` |
| 重試 | per-provider retry policy 在 **route 註冊時凍結**；`normal`(maxRetries + retryableCodes) / `always`；initialDelay / maxDelay / jitterRatio | in-flight 的失敗不會因為之後換路由而改變復原策略；`providerRetryAfterMs` 是資料不是決策 |
| 空回覆 | 終止在 `stop` 但沒有任何 content block → `finish {kind:'error'}` + `EMPTY_RESPONSE`，預設可重試 | **空回覆是可重試的錯誤，不是安靜的成功** |
| 錯誤復原 | `agent/request-error` waterfall，listener 修好後回 `{ kind: 'retry' }` | 失敗的 step 已經關閉，這次嘗試不提交 assistant message、也不提交工具副作用 |
| 上下文壓力 | compaction 走 `agent/pre-step`（壓力）+ `agent/request-error`（**僅** canonical overflow）；先做 tool-result pruning 再選 summary | 只有 pruning／摘要真的推進了 generation 才開新的 retry turn，否則原始錯誤仍然權威 → 天然防重試死迴圈 |
| 壓力量測 | `token-meter`：`logRevision` 對齊、`usage` anchor vs `estimated` heuristic、每個 surface node 各自定價 | 有號的 `surfaceDeltaTokens` 保留成長與縮小 |
| 巨量工具輸出 | `spill` seam：超過 `maxInlineBytes` 的純文字寫進 0700 目錄下 0600、`open(..,'wx')` 的私有檔，回 opaque locator + `retrievalHint` | 存檔失敗就**保留 inline 原結果**，不把成功的呼叫變成 `isError` |
| 背景工作 | `ctx.jobs`：`JobStart{kind,label,outputLimitBytes,owner,run()}` / `JobHooks{cancel,done,readOutput}` | `owner` 是 live Agent，agent 銷毀連帶取消並 **await**；job 一旦發布就改用 task-owned signal，外層呼叫取消只是不再等待，**不殺已發布的工作** |
| 迴圈衛生 | `repeat-tool-reminder`：連續呼叫同一工具且 canonical 化參數相同時，在設定的長度注入升級版勸告 | 純建議：不出現在工具表、不否決、不改寫，決定權留給模型 |
| 工具逾時 | `timeout-policy`：唯一一個 `tools/execute` 環繞 listener，讀工具自己宣告的 `ToolDefinition.timeoutMs`，回結構化 `TOOL_TIMEOUT` | 零設定：預算屬於工具，不屬於部署 |
| 崩潰可偵測 | compaction 的 lock 是 `start → 摘要 → summary → 替換 → end`，**end 最後才寫** | 中途崩潰留下孤兒 lock，而不是一個謊稱完成的 `end` |

底下托著這一切的是一條律法：**model-visible ⟺ logged**。任何能進到模型 request 的東西都必須能從 append-only session log 重建，而且有 runtime invariant 斷言這件事。`deriveMessages()` 從 log 投影模型歷史，fork / resume / transcript / telemetry / 持久化全部是同一條流的投影。

### 我們：零件大致齊，但沒有那條律法

對應物是有的，而且有些做得很好：

- `electron/piTurnDeadline.ts`：每個 turn 一定有預算（10s–6h clamp），有真實進度就 `extend()`，到期**走跟使用者停止同一條 park 路徑**，結算成 `interrupted(timeout)` 而不是 failed。這條「逾時不引入第二種停止方式」的設計和 dsh 同級。
- `piCoreRuntime.shouldParkTurn()`：只在沒有工具在飛時停，停一次（`parked`），已開始的工具照樣跑完並回報證據。
- `src/agent/llmResilience.ts`：retry + per-provider circuit breaker（sliding window + minSamples + half-open 探測），open 時 fail-fast。dsh **沒有** breaker，這是我們多的。
- `runQueue.ts`（FIFO + dedupe + persist，上限 24）、`maxConcurrentRuns`、run registry 持有容量。
- compaction：`shouldCompactPiContext` + `buildPiCompactionSummary` + `compactPiSession` + compaction checkpoint 記錄。

差距在下面第 4 節，但先點名三個**現在就會斷**的地方：

1. **空回覆被當成功。** `agentStore` 的 Pi 路徑：`result: result.result || 'Pi Core 完成（無文字輸出）'`。dsh 明確把「終止於 stop 但沒有 content」列為 `EMPTY_RESPONSE` 可重試錯誤。我們把它寫成一句中文成功訊息並歸檔。
2. **中斷後的部分答案是一坨。** `interruptedTurnResult()` 把所有 assistant 片段 `join('\n')`，開場白和被打斷的段落混在同一則裡（今天修掉的 `.find()` 取第一段是它的兄弟 bug，同一個「多段 assistant 沒有語意」的根因）。
3. **Host 的歷史投影是有損的。** `session.messages` 只存 `{role,content}` 純文字，沒有 tool call / result。工具軌跡只活在 Pi 自己的 `sessions/*.jsonl`；那個檔一旦不可用（換機器、清檔、fork 到別的 session），resume 出來的上下文就少了「我做過什麼」。

---

## 2. UI / UX response design

### dsh：瀏覽器端本身就是外掛表，回應是「可重播的節點」而不是字串

- **客戶端組成**：`ctx.clientModules` 掃描宣告 `dsh.client` 的套件，組出 `window.__DSH_BOOT__` 進入圖，每個外掛從 `/plugins/<id>/client.js` 載入。conversation / tool / trajectory / jobs / goal / plan / deliverables / subagent / user-questions / workflow-run / settings… 各自是一個可裝卸的瀏覽器外掛。
- **Conversation Node 引擎**（axis 2 的核心）：一個 durable event family（例如 `review/start|progress|end`，共用一個**穩定業務 id**）→ Context → 增量 State → typed Step data → keyed renderer。硬規則寫在 cookbook 裡：
  - 客戶端**絕不能**把一則 update 指派給「最近那個還沒完成的 Context」；每則事件自己帶 id 或能從自己的 payload 推出 id。
  - 每個 delta 必須在依 `seq` 升冪重播時產生確定性的 State，不得依賴 live-only 記憶。
  - 目前 window 只有 update、還沒載到 start → 保持 pending Context，不建 State；要在 start 載入前就渲染，就得由終止或 checkpoint 事件自己帶足夠的 fallback 狀態，**不准靠掃描別的事件回補**。
  - 新的業務列 = 宣告合併一個 `ChatNodeDataMap` key + 註冊 Definition + 註冊 keyed renderer；**不改中央 renderer switch，也不改 Session fold**。
- **工具卡片是型別化的 render intent union**：`generic` / `terminal` / `diff` / `search` / `web`，外加 `locations: [{path, line?}]`。`presentCall(args)` 與 `presentResult(args, result)` **必須是純函數**（它們會在 session log replay 上再跑一次）：不得 I/O、不得讀 session 狀態、不得用時鐘或亂數。UI-only 的格式（```console 圍欄、diff、相對路徑）**不准混進模型可見的結果**。`defineTool` 對顯示路徑軟驗證：畸形或舊版的 log 參數回 `undefined` 走 generic fallback，**顯示永遠不能讓 replay 崩掉**。
- **串流尾巴隔離 + Think 列**：思考列預設收合；當它是串流尾巴時，摘要從「已結算的第一行」切換成「最新的非空行」，單行 scrollport 跟到行尾；一展開就取消跟隨（閱讀不跟自動捲動打架）；結算後回到穩定的第一行。
- **Deliverables 列**：turn 收尾時列出產出的檔案，來源是 mutation 工具**自己宣告的 `locations` 與 render intent**，不是模型的結語散文——「模型忘了講的檔案照樣列出來」。收尾散文裡的 inline code 只有在「精確路徑」或「恰好是唯一一個產出路徑的 basename」時才連結；兩個路徑同名就保持惰性，**寧可不連也不猜**。
- **審批佔用 composer**：approval / question 都以 composer takeover 呈現（琥珀色條、理由標題、從執行中呼叫的 args 配出的指令行、一次性 refuse/allow），流程裡**不留佔位卡**。
- **Compaction 呈現**：在流程的正確位置渲染成一列收合列，**不取代上面的 transcript**；已完成的 checkpoint 顯示被替換的項目數與估算 token，點開才揭露摘要；引用的 `compaction/summary` 落在載入 window 之外時，該列仍然可見但不可展開。

### 我們：`ChatBubble` + 面板群，但對話本身是字串

現況：`pushBubble(threadId, role, content)` 寫進 `threadStore`，UI 渲染 `ChatBubble`；執行過程走 `RunProcessFeed` / `InlineRunPanel` / `StepTimeline` / `RunSummaryCard`；產出走 `WorkflowDeliverablesPanel`；HITL 走 `PermissionAskModal` / `QuestionAskModal`。

具體落差：

| 面向 | dsh | 我們 |
|---|---|---|
| 回應模型 | 事件族 → Context → State → keyed node，可依 seq 重播 | `pushBubble(role, string)`，一則就是一顆泡泡 |
| 工具卡片 | 工具宣告 `presentCall/presentResult` + `locations`，純函數、replay-safe | `taskRunCoordinator` 用 `/write\|edit\|create\|patch/i` **正則猜** kind，再從 activity / `toolCalls` / `piHostAudits` **三路合併**；`ToolDefinition` 沒有任何 presentation 欄位 |
| 產出檔案 | 由 render intent 折出，模型沒提也會列 | 同上正則 + `fileMap` 猜 |
| 串流 | `assistant/chunk` 是 durable 事件，聊天流自己有串流尾巴 | 串流進的是流程面板的 `draftText`，最終才**另外**推一顆泡泡；而且 CLI 路徑 `clearDraft()`、Pi 路徑不清 → 同一段文字在兩個 runner 下的去處不一致 |
| HITL | composer takeover，pending 狀態經 projection 連沒實例化的 session 都看得到 | modal 彈窗 |
| 新業務列 | 註冊一個 Definition + renderer，不碰中央 switch | 新面板 = 改元件 + 改 coordinator |

---

## 3. 任務開始 → 任務中 → 任務結束 的階段顯示

### dsh：兩個域刻意分開，而且拒絕編造

**durable（可重播）**：`turn/start` → `step/start` → `user/message` → `assistant/chunk*` → `assistant/message` → `tool/call*` → `tool/result*` → `step/end` → `turn/end`。
**live（協調用）**：`agent/status`、`agent/inbox/{spliced,inserted,claimed}`、`agent/pre-step`、`agent/request`、`agent/turn-stopping`。

幾個值得抄的決定：

- `AgentStatus` 只有 `idle | running`，而且文件明講 **running 描述的是 driver 的 drain 區間，不證明某個 turn 還開著**；disposal 不是第三種狀態。刻意不讓 UI 誤讀成「這一輪還在跑」。
- **Trajectory 視圖**（獨立的 view tab）：粗分隔線標 turn 邊界、內嵌小標記標 step；主 ledger 只留 index / event / content，選取才開 inspector 看 token usage、duration、Input、Output、Timing。上方固定的 Overview 時間軸由左到右投影真實的起點與長度，**assistant span 切分 TTFT 與 decoding**，hover 500ms 揭露精確時鐘；拖曳選區間可聚焦「該區間內任何時刻活著的所有記錄」，滾輪縮放時間域，右鍵清除選取、右鍵拖曳平移。
- **長 ledger 的工程**：開在當前尾端，捲到已載入範圍頂端時載入**上一頁**；只掛可見列窗 + 少量 overscan；prepend 之後語意 row key 與 ARIA index 仍然成立；串流時貼底，使用者往上捲就**暫停跟隨**，不讓新記錄打斷閱讀。
- **進行中不編造時間**：`partial` 與 `runningCalls` 只顯示 running，不給假的 duration；Overview 只畫起點標記。更早的前綴還沒載入時，用一個中性省略號控制項標示被省略的前綴，**不給未知歷史捏造長度**。
- **Jobs popover**：只有這個 session 真的有 job 時才長出控制項；badge 只數 `running + stopping`，零就不顯示；live rows 依 `startedAt` 升冪、settled 依 `finishedAt` 降冪，同毫秒用啟動順序破平手（**不讓 host 的 map 迭代順序決定畫面**）；duration 每秒跳一次、settled 凍結在 `finishedAt`，缺 `finishedAt` 讀成 0 而不是負數。
- **Goal / Todo / Plan** 各自是 composer dock 的獨立卡，資料一律是 host 算好的 projection whole value（`useProjection`），client 端**不 fold 領域事件**、不持有領域 store。

### 我們

有的：`RunProcessFeed`（「執行過程 · N 項」）、`StepTimeline`、`phase`（starting / thinking / finalizing）、orchestration 的 `iterations` / `maxIterations` / `dodMet`、`interruptReason`（user / timeout）、`RunSummaryCard`。

缺的：

1. **沒有 turn / step 座標。** 我們的狀態機是 run 級的 `success / failed / halted / interrupted`；一個 run 內部的第 3 個 step 沒有可定址的身分，所以沒有 trajectory、沒有 per-step 的 usage / duration。
2. **沒有 TTFT 與 decoding 的拆分**，也沒有可稽核的時間軸。
3. **進度是 ephemeral 的。** `runActivityStore` 的 `MAX_EVENTS = 120`、終局摘要 `MAX_TERMINAL_EVENTS = 40`、`MAX_TERMINAL_DRAFT = 8_000`。截圖那次是 40 項，正好貼在終局上限；超過 120 個事件的長任務，最早的段落會直接掉。而且沒有「往上翻一頁」的路徑可以救。
4. **階段是被翻譯成中文標題的事件**（`piHostActivity.ts` 把 `turn_start` 對成「開始回合」），不是帶座標的記錄。
5. `operations` 是一條四層的 fallback 階梯（activity → piHostOperations → toolCalls → steps+logs），四種形狀各自成立——這正是「沒有單一事實來源」的味道。

---

## 4. Harness engineering 差距、斷點與缺口

依「修了最值錢」排序。

### P0-1 沒有「durable log 是 UI 唯一事實」這條律法 —— 今天那個 bug 的結構性根因

dsh：`model-visible ⟺ logged` + runtime invariant 斷言，UI 全部從 log 投影。
我們：三套半的事實來源同時存在 —— Pi Host `state.json` 的 `session.messages`（只有文字）、Pi 自己的 `sessions/*.jsonl`（完整）、renderer 的 `threadStore` bubbles（字串）、`runActivityStore`（ephemeral）。它們可以互相不一致，而且今天就不一致：jsonl 是對的，另外兩個拿了開場白。
**動作**：讓 renderer 的對話從 Host 事件投影重建，`pushBubble(tid,'assistant',finalAnswer)` 降級成投影裡的一個 case；`session.messages` 補上工具軌跡或改為由 log 投影。

### P0-2 沒有「組裝後 transcript」的快照測試 —— 為什麼他們不會犯我們今天的錯

dsh 的測試政策明文：**每一個模型可見或使用者可見的行為變更，都要在同一個 PR 加一個 keyless snapshot，而且必須跑在真的可執行的範例上**；「套件測試、e2e-only 斷言、mock-only fixture 都不能代替組裝後的應用 transcript」。他們甚至要求 TS 與 Python 兩個 SDK 的 expected output 一起更新。
我們：smoke 多半是 drift guard 與單點 e2e。今天那個 bug 的形狀正是「單一 assistant 訊息的 smoke 全綠，多段就爆」——`smoke-pi-turn-success.mts` 只有一則訊息。我補的 `smoke-pi-turn-final-answer.mts` 是第一個「工具往返 + 多段 assistant」的組裝快照；這類的應該變成規則而不是特例。

### P1-1 工具沒有 presentation 契約

`ToolDefinition` 只有 `description / keywords / parameters / owningCapability`。UI 語意靠 coordinator 的正則猜，產出檔案靠 `fileMap` 猜。
**動作**：`ToolDefinition` 加 `presentCall` / `presentResult`（純函數、replay-safe）與 `locations`；把 coordinator 的正則與四層 fallback 換成單一來源。這一步同時解掉「產出檔案清單不可靠」與「新工具要改中央程式碼」。

### P1-2 空回覆當成功

見 §1 斷點 1。dsh 把它列為可重試錯誤碼並預設重試；我們寫一句「Pi Core 完成（無文字輸出）」然後歸檔、跑 learning loop、算 confidence 0.9。

### P1-3 沒有可插拔的 request-error 修復點

dsh 的 `agent/request-error` 允許 listener 先修（換模型、砍 context、等 retry-after）再回 `{kind:'retry'}`，而且失敗的 step 已關閉、不提交半套副作用。
我們只有「retry → breaker → 降級」。缺的是中間那層「修好再試」。

### P1-4 巨量工具輸出只有截斷，沒有 spill

我們到處是 `.slice(0, 400)` / `.slice(0, 200_000)`。截斷是有損的；dsh 的 spill 是**存全文 + 回 locator + 回 retrieval hint**，而且存檔失敗時保留 inline 而不是把成功變失敗。

### P2-1 背景工作的所有權模型較弱

dsh 的 job `owner` 是 live Agent，agent 銷毀連帶 cancel 並 await；job 一旦發布就改用 task-owned signal，外層取消只是不再等待。我們的 `runQueue` / `hermes/backgroundJobs` 沒有這層所有權與收斂保證。

### P2-2 沒有 trajectory / 沒有 step 座標 / 進度不持久

見 §3。

### P2-3 HITL 是 modal 而不是 composer takeover

以及沒有 `pendingInteraction` 這種「連沒實例化的 session 都能顯示待審批」的投影。

### 我們比較強的地方（公允起見）

- **單一 ingress + 唯一收尾交易**：`runTask` 一手包 capacity / attachments / thread bind / beforeRun / dispatch snapshot / summary → afterRun → Archive → onSettled → release → drain。dsh 的 lifecycle 攤在 loop 與各外掛上，這種「一個地方負責收尾」的產品級保證他們沒有明確對應物。
- **觸發器 fail-closed 准入**：時間觸發只能來自已認領的 ScheduledJob、Proactive 只能來自驗證過的 event-matcher 證據，都是必填型別、在 admission 斷言。dsh 的 schedule 是「durable reminder 回到原 session 變成一般 turn」，沒有這種准入層。
- **Runner 能力誠實宣告**：`EXTERNAL_CLI_RUNNER_CAPABILITIES` 把 parse / DoD / iterate 明確標成 false，「CLI 成功 ≠ DoD met」寫進型別。
- **LLM circuit breaker**：dsh 只有 retry policy，沒有 breaker。
- **Secrets 邊界**：token 只在 main 的 safeStorage 檔，`{{secret:key}}` 只在 main 解析，renderer 拿不到原始 token。（但 dsh 有 native landlock sandbox，程序隔離那一側他們比較強。）

---

## 5. 最短路徑建議

1. 先補 P0-2（組裝 transcript 快照變成規則）——成本最低，直接擋住這一類 bug 再發生。
2. 再做 P1-1（工具 presentation 契約）——它一次解掉 UI 猜測、產出清單、與新工具要改中央程式碼三件事。
3. 然後 P0-1（對話從投影重建）——最大但最值錢；做完之後 P2-2 的 trajectory 才有地基。
4. P1-2 / P1-3 是小修：空回覆改判可重試、`agent/request-error` 等價的修復點插在 `piHostProtocol` 的 turn 失敗路徑上。
