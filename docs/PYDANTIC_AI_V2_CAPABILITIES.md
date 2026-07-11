# Pydantic AI 2.0 Capability 概念 → SubAgents AI 實作對照

來源:影片「Pydantic AI 2.0 来了:一个 capability 原语,重构智能体开发」
(https://www.youtube.com/watch?v=56JRk6RfUJo)與 Pydantic AI v2 官方發佈文
(https://pydantic.dev/articles/pydantic-ai-v2)。

Pydantic AI 2.0 的核心變化是把指令(instructions)、工具(tools)、生命週期掛鉤、
模型設定收進**一個原語:capability**,並以**漸進式披露**與三個省 token 能力
(Tool Search / CodeMode / 人類審批)重構智能體開發。以下是各概念在本專案的落點。

## 1. Capability 原語

> v1 把 system_prompt、tools、instrument 塞進建構子;v2 全部收進 capabilities 列表。

| Pydantic v2 | 本專案 |
|---|---|
| `Capability(id, description, ...)` | `AgentCapability`(`app/src/agent/capabilities/types.ts`) |
| instructions + tools 打包 | `instructions` + `tools` / `toolNames` / `toolNamePrefixes` |
| model settings 隨包 | `modelSettings`(temperature / maxTokens / model,active 時套用,後載者覆蓋) |
| 跨 agent 共享 | builtin / skill / MCP / user 來源統一組裝(`assembleCapabilities`) |

內建包:`core-utils`、`web-research`、`workspace`、`shell`、`memory`、`skills`、
`codegraph`、`delegate`、`messaging`、`mcp-bridge`、**`code-mode`**(新)。

## 2. 漸進式披露(Progressive Disclosure)

> 能力初始只是一行目錄條目,模型判斷要用才 load;狀態存進歷史可恢復。

- `deferLoading: true` → 系統提示只出現 `- id: description` 目錄行。
- 模型呼叫 `load_capability(id)` → 工具 schema + runbook 一起展開。
- **跨步驟**:`loadedCapabilityIds` 進入 `AgentState`,每步 `preloadCapabilityIds` 還原。
- **跨 run / 續聊**:run 結束寫入 `thread.lastCapabilityIds`(+ `lastUnlockedTools`),
  下一輪 `dispatchThreadTask` 回灌(對齊 Pydantic「載入狀態存進歷史」)。
- Settings 可把個別包改為 always-on(`alwaysOnCapabilities`,含 skill:* / mcp:*)。

## 3. 更省、更可控(本次新增)

### 3a. Tool Search(`tool_search`)

> 工具太多先藏起來,模型靠關鍵字按需檢索。

- 可見工具 schema 超過 `toolSearchThreshold`(預設 24)時,只保留:框架工具、
  always-on 包的工具、已解鎖工具;其餘藏進池子。
- 模型呼叫 `tool_search(query)` → 關鍵字比對 name / description / registry keywords,
  解鎖 schema;若命中的工具屬於未載入的 capability,**自動載入該包**並附上 runbook。
- `load_capability` 對大型 MCP 伺服器(prefix 工具 > 8 個)不會一次展開,
  改提示用 tool_search 檢索 — 大幅省下 MCP 工具定義佔用的 context。
- 實作:`runtime.ts` 的 `applyToolSearchVisibility` / `searchTools` / `toolSearchToolDef`。

### 3b. CodeMode(`run_code`)

> 把工具包成 run code,模型寫一段帶迴圈的 JS 一次跑完,N+1 輪壓成 1 輪。

- `code-mode` capability(deferred)提供 `run_code` 工具。
- 程式碼在 **Web Worker 沙箱**執行(無 DOM / preload 存取),
  以 `await tools.<name>({...})` RPC 回主執行緒。
- **網路隔離**:Worker 啟動時 `self.fetch` / `XMLHttpRequest` / `WebSocket` 設為 undefined,
  強制走 `tools.http_fetch`(supervisor + 審計)。
- 每個內部呼叫仍走同一條 capability gate + `authorizeTool`(HITL / permission policy /
  supervisor payload 限制),並記錄為 `run_code›<tool>` 的 ToolCallRecord 供 UI 稽核。
- 防護:逾時終止 worker(預設 90s)、內部呼叫上限 25、
  禁止 `run_code` / `delegate_task` / 框架工具遞迴。
- 實作:`app/src/agent/tools/codeMode.ts` + `toolLoop.ts` 的 RUN_CODE 分支。

### 3c. 人類審批(capability 宣告式)

> 給工具標上待審批,危險操作停下來等放行。

- `AgentCapability.approvalTools: string[]` — 該包 active 時,列出的工具**每次執行**
  都強制 HITL ask(`authorizeTool` 新增 `forceAsk`,allow pattern 無法繞過)。
- `code-mode` 內建 `approvalTools: ['run_code']`;`shell` 宣告 `bash`。
  與既有 `bashRequireAsk`、permission policy、Safety 閘道疊加。
- **三段核准模式**(ChatGPT 式,`settings.approvalMode`,composer pill + Settings 皆可切換):
  - `always` 要求核准 — 副作用工具(編輯檔案/網路/mcp_*/run_code…)一律先問
  - `auto` 代我核准(預設)— 僅偵測為可能不安全者 ask(即上述疊加行為)
  - `full` 完整存取權 — 跳過 HITL ask 與 safety intervention;
    deny 規則(隔離封鎖/權限 deny/bash deny pattern)與 supervisor 限制**仍生效**
  - **無人值守降級**:排程/webhook/Telegram(unattended)一律 `full → auto`
    (`effectiveApprovalMode`),完整存取權只在有人盯著的互動 run 生效
  - **自訂工具補網**:任意名稱的 custom http/bash 工具不在靜態副作用清單,
    toolLoop 以 `sideEffect` hint 傳入,`always` 模式下照樣先問
  - 決策核心:`toolGuard.decideApprovalNeed` + `effectiveApprovalMode`(純函式,smoke-caps 鏡射測試)
- **無人值守 HITL**:排程 / Webhook / Telegram 設 `unattended: true` →
  ask 45s / safety intervention 短逾時自動 deny,避免全域執行鎖掛死。
- **leaf blockedTools**:組裝目錄時剔除空包,避免模型 load 後才發現工具被拒。

## 3d. 自動化佇列(可靠性)

忙碌時不永久 skip:`runQueue.ts` FIFO(上限 24、去重)→ run 結束 drain。
`onSettled` 回呼讓 once-job 補跑後仍可 `markJobResult`。

## 4. 設定項(Settings → 安全)

| 設定 | 預設 | 說明 |
|---|---|---|
| `capabilitiesEnabled` | on | 漸進式披露總開關(既有) |
| `toolSearchEnabled` | on | Tool Search 隱藏+檢索 |
| `toolSearchThreshold` | 24 | 超過此可見 schema 數才啟動隱藏 |
| `codeModeEnabled` | on | 是否註冊 code-mode capability |
| `approvalMode` | auto | 三段核准:always 要求核准 / auto 代我核准 / full 完整存取權 |

## 未採用的部分

影片第 4 段(v1→v2 遷移、openai-chat 前綴、provider 分包)屬 Pydantic 套件自身的
打包/遷移事務,與本框架無對應物,未實作。
