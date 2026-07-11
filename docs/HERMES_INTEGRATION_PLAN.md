# Hermes Agent → SubAgents AI 核心整合計畫

> 來源：[NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent)（MIT）  
> 目標：把 Hermes **可移植的核心概念** 以 TypeScript 實作進本 Electron 桌面專案，**不**整包搬運 Python 執行時／Gateway／70+ 工具。

---

## 1. Hermes 幾大核心（分析摘要）

| # | Hermes 核心 | 機制 | 對本專案價值 |
|---|-------------|------|--------------|
| A | **Agent Loop** | `AIAgent.run_conversation`：prompt → LLM → tool_calls → 迴圈 | 已有 engine + function calling；可對齊「穩定 system prompt」原則 |
| B | **Skills 程序記憶** | `SKILL.md` + agentskills.io；任務後可自動寫 skill | **高** — 可複用工作流 |
| C | **Persistent Memory** | MEMORY.md / USER.md、memory tool、定期 nudge | **高** — 跨 session 偏好 |
| D | **Prompt 分層** | stable（身份/skills）→ context（AGENTS.md）→ volatile（memory/時間） | **高** — 提升一致性、利於 cache |
| E | **Session + FTS5** | SQLite 會話全文搜尋、跨 session 召回 | **高** — 已有 archive，可升級 |
| F | **Context Compression** | 超長對話中段摘要 | **中** — LLM 模式下需要 |
| G | **Cron** | 排程 + 技能掛載 | **已有** Scheduler，可掛 skill |
| H | **Delegate 子代理** | 隔離 context 的 leaf/orchestrator | **部分已有** multi-agent |
| I | **Toolsets / Registry** | 70+ tools、toolset 分組 | 已有 tools；可加 skill/memory 工具 |
| J | **Messaging Gateway** | TG/Discord/Slack… | **延後** — 桌面優先 |
| K | **Terminal backends** | Docker/SSH/Modal… | **延後** — 安全與複雜度高 |
| L | **MCP / Plugins** | 動態能力 | **Phase 3+** |

### 本專案已具備（對照）

- Loop 四模式、DoD、HITL、Supervisor  
- Function calling、工具沙箱、Webhook、Cron 排程  
- 中文左側選單 UI  

### 刻意不導入（第一期）

- 完整 messaging gateway  
- 六種 terminal backend  
- Honcho / 第三方 memory SaaS 綁定  
- Trajectory 訓練資料產線  

---

## 2. 分階段實作路線

### Phase 1 — 學習腰部（Memory + Skills + Prompt）✅ 已實作

1. **Memory Store**  
   - `MEMORY.md` / `USER.md`（workspace 或 userData）  
   - 工具：`memory_read` / `memory_append` / `memory_search`  
   - 字元上限與 supervisor 對齊  

2. **Skills Store（agentskills 風格）**  
   - `skills/<name>/SKILL.md`（YAML frontmatter + 正文）  
   - 索引注入 system prompt  
   - 工具：`skill_list` / `skill_load` / `skill_save`  

3. **Prompt Builder**  
   - stable：人格 + 工具指引 + skills 索引  
   - context：`AGENTS.md` / 專案說明  
   - volatile：memory 摘要 + 當前時間  

4. **引擎接入**  
   - Goal-based / Turn-based 在 LLM 路徑注入分層 prompt  
   - 成功後可寫入 memory 草稿  

### Phase 2 — 閉環學習 + 召回 ✅ 已實作

1. **Learning Loop**  
   - 成功 Goal-based 後：自動產生 skill 草稿（可人工核准）  
   - 週期 nudge：提醒寫 memory  

2. **Session Search**  
   - 對 archive + logs 做全文索引（簡化 FTS：in-memory / JSON index）  
   - UI：學習中心頁  

3. **Context Compression**  
   - stepOutputs 過長時 LLM 摘要  

### Phase 3 — Cron Skills + MCP ✅ 已實作

1. **Cron 掛載 Skills** — `ScheduledJob.skillNames`；到期執行注入 skill body 至 prompt  
2. **最小 MCP client** — HTTP JSON-RPC + Electron stdio；工具 `mcp_list_tools` / `mcp_call`  
3. 設定 UI：MCP 伺服器列表、探測工具  
4. 自動化 UI：建立任務時多選 Skills  

### Phase 4 — Delegate + MCP schema + Plugins ✅ 已實作

1. **delegate_task** — leaf 隔離上下文、深度/並行預算、封鎖 skill_save／再委派  
2. **MCP 動態 FC schema** — `mcp_<serverId>_<tool>` 注入 function calling  
3. **Plugins JSON** — userData/plugins + 學習中心「外掛」；注入 skills / prompt 片段  

### Phase 5.5 — 多 Thread + 對話設定 ✅ 已實作

1. **多 Thread 分欄** — 左側 session、⌘N、localStorage  
2. **內嵌執行** — `InlineRunPanel`，不跳 `/execution`  
3. **模型 + 思考深度**（非品牌 Provider）  
4. 文件：`docs/AGENT_UI_INTEGRATION.md`  

### Phase 5.6 — OpenCode 概念整合 ✅ 已實作

1. **Build / Plan** 主代理（Tab 空輸入切換、`/build` `/plan`）  
2. **權限** allow/ask/deny（Plan 禁止 edit）  
3. **@general / @explore** subagent mention  
4. 文件：`docs/OPENCODE_INTEGRATION.md`  

### Phase 5 — Messaging + 背景委派 + 長連線 MCP ✅ 已實作

1. **Messaging Gateway（Telegram）**  
   - Electron main 長輪詢 `getUpdates`  
   - 設定：Bot Token、允許 Chat ID、自動執行、完成回覆  
   - 工具：`message_send`；slash：`/gateway`  
   - UI：設定 → 訊息閘道  

2. **背景 delegate + notify_on_complete**  
   - `delegate_task({ background: true, notify_on_complete })`  
   - `backgroundJobs` 佇列 + 桌面通知  
   - 工具：`delegate_status`；slash：`/jobs`  

3. **長連線 stdio MCP session**  
   - 行程常駐、Content-Length / NDJSON 訊框  
   - `stdioEnsure` / `stdioStop` / `stdioSessions`  
   - 設定 UI：啟動長連線 / 停止全部  


---

## 3. 目錄對應

```
app/src/agent/
  hermes/
    memory.ts       # 持久記憶
    skills.ts       # Skills 系統
    promptBuilder.ts
    learning.ts     # 學習迴圈
    sessionSearch.ts
    types.ts
```

UI：`/learning`（記憶 / 技能 / 會話搜尋）— 中文側欄「學習」

---

## 4. 授權與歸因

- Hermes：MIT（Nous Research）  
- 本專案實作為 **概念對齊的獨立 TypeScript 實作**，非 fork 二進位。  
- 文件與 UI 標註「靈感來自 Hermes Agent」。  
