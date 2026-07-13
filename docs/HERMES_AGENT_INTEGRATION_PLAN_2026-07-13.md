# Hermes Agent（nousresearch/hermes-agent）× SubAgents AI 深度整合分析與計畫書

> 日期：2026-07-13
> 來源版本：本次 `git clone --depth 1 https://github.com/nousresearch/hermes-agent.git`，commit [`e4ea0a0ed7fc24761b2b425146893561a73216e1`](https://github.com/NousResearch/hermes-agent/tree/e4ea0a0ed7fc24761b2b425146893561a73216e1)（2026-07-12）。分析完成後已依指示將 clone 移除，本文件的原始碼引用均可透過上列 commit 連結回查。
> SubAgents AI 比對基準：目前工作區（`app/src/agent/hermes/*`、`app/src/agent/tools/codeMode.ts`）。

## 1. 這個 repo 是什麼、為什麼特別相關

Hermes Agent 是 Nous Research 做的**獨立產品**：一個可跑在 CLI（`hermes` TUI）、也可跑在 Telegram/Discord/Slack/WhatsApp/Signal/Email 等訊息平台的「自我改進」通用 agent，重點賣點是 README 開頭那句：「the only agent with a built-in learning loop — it creates skills from experience, improves them during use, nudges itself to persist knowledge, searches its own past conversations, and builds a deepening model of who you are across sessions.」它不是一個要被當函式庫嵌入的東西（跟 `nexu-io/open-design` 一樣是完整產品），Python 單體、少數幾個檔案就 60-700KB（`cli.py` 731KB、`run_agent.py` 265KB、`hermes_state.py` 287KB）。

特別值得注意：**這次比對的對象不是巧合。** SubAgents AI 現有的 `app/src/agent/hermes/` 子系統本身就已經在程式碼註解裡明講是照著 Hermes Agent 的概念做的簡化版：

- `learning.ts:1-2`：「Closed learning loop — inspired by Hermes self-improvement」
- `sessionSearch.ts:1-3`：「Cross-session recall — simplified FTS over archive + memory + skills（Hermes uses SQLite FTS5; we use token scoring for portability.）」
- `sessionSearch.ts:82`：「Compress long step outputs (Hermes context compressor lite)」

也就是說，這份計畫書不是在建立一段新關係，而是**把一段已經承認的抄襲/致敬關係，對照到真正成熟的原始碼上再深化一次**——之前這幾個檔案顯然是憑印象/文件描述寫的簡化版，這次直接讀了 Hermes Agent 目前的實作。

## 2. 幾大核心支柱：逐一比較

### 2.1 Skills（程序性記憶）—— 有雛形，缺「持續維護迴圈」

**Hermes Agent**：技能是使用者手寫或 agent 自動產生的 Markdown（相容 [agentskills.io](https://agentskills.io) 開放標準），內建一個**龐大且分類完整的技能庫**（`skills/{apple,creative,data-science,email,github,media,mlops,note-taking,productivity,research,smart-home,social-media,software-development}/...`，另有 `optional-skills/` 選配包）。更關鍵的是 [`agent/curator.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/agent/curator.py)：一個**閒置觸發**（不是 cron，是「agent 閒下來、且距上次 curator 執行超過 `interval_hours`」才跑）的背景維護 agent，用**輔助模型**（不動主 session 的 prompt cache）審查所有 `agent-created` 技能，可以 pin／archive／consolidate／patch，但**嚴格不可自動刪除**（只能封存，可復原）。

**SubAgents AI 現況**：`app/src/agent/hermes/skills.ts` 已經有 `createdBy: 'agent' | 'user'` 的來源欄位（`skills.ts:95`）——這正是做 curator 的前提，已經具備。`learning.ts` 的 `pendingSkillDrafts` 只是「成功跑完一次後起草一個新技能，等使用者核准」的**一次性**流程；技能一旦被核准建立，之後沒有任何機制回頭審查、合併重複、或封存過時的技能。

**差距**：有資料模型、無維護迴圈。技能庫會隨使用只增不減，容易長出重複或過時的技能而沒有人清。

### 2.2 Memory —— 有雛形，架構是單體而非可插拔

**Hermes Agent**：[`agent/memory_manager.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/agent/memory_manager.py) 是可插拔 provider 架構，圍繞每個 turn 有明確生命週期：`build_system_prompt()`（把記憶摘要塞進 system prompt）→ `prefetch_all()`（turn 前依使用者訊息預取相關記憶）→ `sync_all()` / `queue_prefetch_all()`（turn 後寫回）。同時支援 [Honcho](https://github.com/plastic-labs/honcho) 的「dialectic user modeling」——不是存一條條事實，而是持續對使用者建立一個可被詢問的模型。

**SubAgents AI 現況**：`app/src/agent/hermes/memory.ts` 是單一 `MemoryStore` class，`learning.ts` 每 5 個 turn（`turnCounter % 5 === 0`）觸發一次固定文案的「記憶提醒」，沒有 prefetch/sync 的 per-turn 生命週期，也沒有 provider 抽象（只有一種記憶來源）。

**差距**：這塊差距最大、但也最難「深度整合」——Honcho 式使用者建模是一整套獨立服務，不建議照搬；比較務實的是借用**per-turn prefetch/sync 生命週期**這個架構形狀，而不是它的任何一個 provider。

### 2.3 Cross-session search + context compression —— 已致敬、可加強

`sessionSearch.ts` 本身就承認是簡化版：token 比對取代 FTS5，純截斷取代摘要。Hermes Agent README 明講是「FTS5 session search **with LLM summarization** for cross-session recall」——LLM 摘要這一步我們完全沒有；`compressStepOutputs()` 也只是保留頭尾、中間丟棄，沒有摘要。

**差距**：可以在既有 token-scoring 之上疊加一個可選的 LLM 摘要層，不必换掉底層算法（也不必為了 FTS5 導入 SQLite）。

### 2.4 Delegation（子代理）—— 同步模式已對齊，非同步模式有明確缺口

**Hermes Agent** 有兩種委派：

1. [`tools/delegate_tool.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/tools/delegate_tool.py)（同步）：子 agent 全新 context、限制工具集、平行批次模式，「The parent's context only sees the delegation call and the summary result, never the child's intermediate tool calls or reasoning」——這跟我們 `agent/hermes/delegate.ts`（leaf/orchestrator isolation + `DelegationBudget`）幾乎是同一個設計，**已對齊**。
2. [`tools/async_delegation.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/tools/async_delegation.py)（背景）：子 agent 完成後，結果進一個 completion queue；**下次主 agent 閒置時，會被當成一個全新的 user/internal turn重新送進同一個對話**，而不是塞進歷史中間（避免破壞 message-role 交替與 prompt cache 的硬性不變量）。

**SubAgents AI 現況**：`app/src/agent/hermes/backgroundJobs.ts`（317 行）目前只做 `archiveBackgroundJob()`——寫進 Archive/Records store＋桌面通知；我 grep 過整份檔案，**沒有任何把結果重新餵回原本那個 thread、讓主 agent 在下一輪對話裡實際看到並使用這個背景結果的路徑**。使用者必須自己想到要去 Records 頁面看。

**差距**：這是本輪找到**最具體、最可落地**的一個缺口——資料都已經有了（`job.summary`／`job.threadId` 等），純粹缺「背景工作完成時，若原 thread 閒置，插入一則新 turn」這段管線。

### 2.5 Code Execution / Programmatic Tool Calling —— 概念已對齊，傳輸層天生不同

[`tools/code_execution_tool.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/tools/code_execution_tool.py)：LLM 寫一段 Python，透過 RPC 呼叫 Hermes 工具，「collapsing multi-step tool chains into a single inference turn」「only the script's stdout is returned to the LLM; intermediate tool results never enter the context window」——這跟我們 `agent/tools/codeMode.ts`（`run_code`，Blob Web Worker 執行模型寫的 JS，`tools.<name>(args)` RPC，`fetch`/`XHR`/`WebSocket` 全部關閉）**核心理念完全一致**，只是傳輸層天生不同（他們是 Unix Domain Socket / 檔案輪詢，因為要支援 Docker/SSH/Modal/Daytona 等遠端後端；我們是 Web Worker postMessage，因為我們是單一 Electron 行程）。這塊**不需要改**，算是核實過的「已對齊」。

### 2.6 Cron / 自動化建議 —— 我們沒有的一個新點子

Hermes Agent 的排程本身（[`cron/scheduler.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/cron/scheduler.py)：tick-based，跨平台投遞）跟我們的 scheduler／`runQueue.ts`／Proactive loop pattern 是同一類設計，不是重點。真正新的是 [`cron/suggestions.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/cron/suggestions.py)：**一個「建議」層**，來源可以是 `catalog`（內建常見自動化模板）、`blueprint`（技能自帶的排程規格）、`usage`（背景自我改進審查發現使用者重複做某件事）、`integration`（使用者接了某個帳號後，順勢建議相關自動化）。核心規則：**建議永遠不自動變成真的排程**——使用者要嘛接受（呼叫既有的 `create_job`，沒有第二套排程引擎）、要嘛拒絕（用穩定 `dedup_key` 記住，不再重複打擾）。

**差距**：我們目前的 Automation 頁面（`AutomationPage.tsx`）是純使用者手動建立，沒有任何「系統主動建議」的層。這是一個**淨新功能**，不是修補既有缺口。

### 2.7 MCP —— 只有 client，沒有 server

我們的 `agent/hermes/mcp.ts` 是純 client（`mcpListTools`／`mcpCallTool`／`listAllMcpTools`，經 Electron main 走 stdio）。Hermes Agent 除了消費 MCP server，自己也是一個 [`mcp_serve.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/mcp_serve.py) MCP **server**：把「跨所有已連線平台的對話」暴露成 9 個 MCP tools（`conversations_list`、`messages_read`、`messages_send`、`events_poll`、`permissions_respond` 等），讓 Claude Code / Cursor / Codex 這類外部 agent 可以直接讀寫它的訊息與核准佇列。

**差距**：我們完全沒有「反向」路徑——外部 agent 無法透過 MCP 查詢 SubAgents AI 目前的 thread、archive、待核准的 HITL 請求。考慮到我們已經有 Telegram gateway、webhook server、thread/archive store（CLAUDE.md 已列出這些元件），暴露一個唯讀（至少先唯讀）的 MCP server 是相對收斂、風險可控的擴充。

### 2.8 Gateway 平台架構 —— hardcoded vs 可註冊

[`gateway/platform_registry.py`](https://github.com/NousResearch/hermes-agent/blob/e4ea0a0ed7fc24761b2b425146893561a73216e1/gateway/platform_registry.py)：平台轉接器（Telegram/Discord/Slack/WhatsApp/Signal/BlueBubbles/微信/元寶……）可以自我註冊，內建的繼續走 if/elif，但外部/plugin 可以用 `platform_registry.register(PlatformEntry(...))` 掛新平台，gateway 端優先查 registry，查不到才 fallback 到舊 if/elif。我們的 webhook server／Telegram gateway 目前是寫死在 `electron/main.ts` 裡（依 CLAUDE.md 描述）。

**差距**：屬於架構彈性問題，不是功能缺口——只有在真的要新增第二個訊息平台（例如 Discord）時才會感受到痛點。優先度低於前面幾項。

## 3. 不建議移植的部分

- **Docker / SSH / Singularity / Modal / Daytona 執行後端**（`tools/environments/*`）：Hermes Agent 定位是可以跑在 VPS/GPU cluster 上、支援 serverless hibernate 的雲端 agent；SubAgents AI 是 Electron 桌面應用，威脅模型與部署形態完全不同。若真的要支援遠端沙箱執行，應該另立計畫，不要跟本輪的「幾大核心」混在一起。
- **Trajectory compression / batch trajectory generation**（`trajectory_compressor.py`、`batch_runner.py`）：這是給訓練下一代 tool-calling 模型用的研究工具鏈，跟一個生產力桌面產品無關。
- **ACP adapter**（`acp_adapter/`，Agent Client Protocol，給 Zed 等編輯器用）：有趣但屬於「讓外部編輯器把 Hermes 當 agent 後端」的整合面，跟本輪聚焦的核心迴圈（skills/memory/delegation/cron/mcp）不同軸，不納入本輪。
- **Provider adapter 的廣度**（20+ 個 `*_adapter.py`）：我們已有自己的 `llm.ts`／`modelProfile.ts` 抽象，沒有必要照抄他們每一個 provider 的 adapter 細節。
- **Computer-use / browser 自動化工具**（`tools/computer_use/*`、`tools/browser_*`）：功能面有價值，但屬於「新增工具類別」而非「核心迴圈整合」，建議另案評估。

## 4. 修改計畫書

### P0：背景委派結果回灌原 thread（對應 §2.4）

- 檔案：`app/src/agent/hermes/backgroundJobs.ts`、`app/src/agent/runExternal.ts`（沿用既有 busy policy／`onSettled`）
- 工作：`archiveBackgroundJob()` 完成後，除了寫 Archive，檢查該背景任務的來源 `threadId` 目前是否閒置（`agentStore.isRunning` 為 false 且無其他排隊任務）；若是，透過既有的 automation-source `runTask`／訊息注入路徑，把結果摘要當成一則新的 assistant/system 訊息插入該 thread，而不是只寫進 Archive。忙碌中則維持現況（寫 Archive＋桌面通知），不要打斷正在跑的東西。
- 驗收：發起一個 `delegate_task(background=true)` 之後不理會它，讓主 thread 閒下來；子任務完成時，主 thread 應該出現一則新訊息帶著結果摘要，而不必使用者自己去 Records 頁面找。

### P0：Skill Curator——閒置觸發的技能維護迴圈（對應 §2.1）

- 檔案：新增 `app/src/agent/hermes/curator.ts`；小改 `skills.ts`（加 `status: 'active' | 'pinned' | 'archived'` 欄位，預設 `active`）
- 工作：仿 `agent/curator.py` 的不變量——只處理 `createdBy === 'agent'` 的技能；使用者手寫的技能永遠不碰；只能封存不能刪除；封存可復原；用一個獨立的、較便宜的輔助模型呼叫（沿用既有 `roleModels` 機制指定一個 role，例如 `Analyzer-1`），不要動主對話的 prompt cache。觸發時機比照原設計：agent 閒置一段時間、且距上次 curator 執行超過設定的間隔（例如 24 小時）才跑一次，不要另開一條 cron。
- 驗收：手動塞入兩個高度重複的 agent-created 技能，閒置觸發後 curator 應該能標記其中一個為候選封存，並在 Learning 頁面留下審查紀錄；使用者手寫的技能不受影響。

### P1：Automation 建議層（consent-first）（對應 §2.6）

- 檔案：`app/src/agent/hermes/`（新增 `automationSuggestions.ts`）、`AutomationPage.tsx`
- 工作：比照 `cron/suggestions.py` 的四個來源模型（catalog／blueprint／usage／integration），但先只做**一個**來源起步——`usage`：background learning loop 若偵測到使用者在短時間內對同一類任務重複發起（可用既有 archive 記錄比對 objective 相似度），產生一筆建議，寫入一個新的 suggestions store，帶穩定 `dedupKey`。UI 在 AutomationPage 頂部顯示「建議的自動化」卡片，接受＝呼叫既有建立排程的 API（不新增第二套排程引擎），拒絕＝用 `dedupKey` 記住不再顯示。
- 驗收：手動製造 3 次相似 objective 的成功執行紀錄後，AutomationPage 應該出現一則對應建議；拒絕後不再重複出現同一則建議。

### P2：Cross-session search 加一層可選 LLM 摘要（對應 §2.3）

- 檔案：`app/src/agent/hermes/sessionSearch.ts`
- 工作：`searchSessions()` 回傳的既有 token-scoring 結果不變（保留 portability）；新增一個可選的 `summarizeSessionHits(hits, query)`，對分數最高的前 3-5 筆呼叫既有 LLM 呼叫路徑產生一段「這些結果跟你的查詢有什麼關係」的摘要，失敗時 fallback 回純 snippet 呈現。
- 驗收：查詢一個模糊詞（不是精確關鍵字比對），能拿到有意義的摘要而不是純截斷片段。

### P2（可選，效益低於前四項）：唯讀 MCP server 曝光 thread/archive（對應 §2.7）

- 檔案：`app/electron/main.ts`（新增 stdio MCP server 進程或 IPC 端點）
- 工作：先只做唯讀：`threads_list`、`thread_get`（讀 bubble 歷史）、`archive_search`。不做 `messages_send`／`permissions_respond` 這類會改變狀態的 tool——避免一開始就要處理外部 agent 觸發 HITL 核准這種高風險路徑。
- 驗收：在 Claude Code 或另一個 MCP client 設定裡指向這個 server，能列出並讀取 SubAgents AI 目前的 thread 清單與內容。

### 不排入本輪（優先度低）

- Gateway 平台自我註冊架構（§2.8）：等真的要加第二個訊息平台再做，現在做是提前優化。

## 5. 驗收定義（本輪整體）

- [ ] 背景委派完成後，若原 thread 閒置，結果會以新訊息形式出現在該 thread，不只是寫進 Archive。
- [ ] Agent-created 技能有一個閒置觸發、不影響主 session prompt cache 的維護迴圈；使用者手寫技能不受影響；只封存不刪除。
- [ ] Automation 頁面能顯示至少一種來源（usage-based）的建議，接受/拒絕語意明確，拒絕後不再重複打擾。
- [ ] Session 搜尋在既有 token-scoring 之上，能選擇性提供 LLM 摘要。
- [ ] （可選）存在一個唯讀 MCP server surface，可從外部 agent 讀取 thread/archive。

## 6. 附錄：clone 清理

分析用的 `./hermes-agent-src`（本地 clone，`e4ea0a0ed7fc24761b2b425146893561a73216e1`）已於本文件完成後移除，未進入版本控制。
