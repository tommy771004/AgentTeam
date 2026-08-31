# AgentStudio — Multi-Agent Team Framework

AI Agent Loop 桌面應用（React + TypeScript + Electron，支援 **macOS** 與 **Windows**）。

## 規格文件

| 檔案 | 說明 |
|------|------|
| `01_System_Definition (系統定義).md` | Loop 核心概念與必備元件 |
| `02_Execution_Rules (執行規則).md` | 四種 Loop Pattern 與 anti-pattern |
| `03_Agent_Prompt_Schema (解析模板).md` | 請求解析 schema |
| `ai_agent_loop_*/code.html` | Stitch UI 原型 |
| `synthetic_intelligence_interface/DESIGN.md` | 設計系統 tokens |

## 應用程式

實作位於 [`app/`](./app/)：

```bash
cd app
npm install
npm run dev        # 開發模式（Vite + Electron）
npm run build      # 僅編譯，不執行 smoke/E2E
npm run check      # 獨立執行檢查與快速 smoke
npm run dist:mac   # 僅編譯並打包 macOS DMG
npm run dist:win   # 打包 Windows NSIS
```

### 已實作能力

1. **Agent Loop Engine** — Receive → Process → Execute → Validate → Terminate/Iterate  
2. **四種 Pattern** — Turn-based / Goal-based / Time-based / Proactive  
3. **Schema Parser** — 使用者輸入 → Loop Configuration JSON  
4. **Multi-agent** — Manager / Analyzer / Writer 分工  
5. **LLM（可選）** — OpenAI-compatible API，Settings 設定，Electron 主進程代理  
6. **Safety HITL** — 敏感操作 Manual Intervention（Approve / Edit / Reject）  
7. **Agent Tools** — web_search、workspace R/W、http_fetch、memory、json_extract  
8. **LLM Function Calling** — 多輪 tool_calls 閉環 + OpenAI tools schema  
9. **Supervisor** — tool payload 限制、MemoryConstraintViolation（可 halt/truncate）  
10. **Scheduler** — Time-based 排程 + 系統匣背景執行 + 通知  
11. **Proactive Events** — 嚴格 boolean 事件規則 + 模擬器  
12. **Webhook Server** — 本機 `127.0.0.1` HTTP 接收 → 匹配規則 → 觸發 Proactive loop  
13. **Per-role models** — Manager / Analyzer / Writer / Core 可各自指定模型  
14. **Dashboard** — 系統健康、webhook、排程、archive 總覽  
15. **Export/Import** — settings + jobs + events bundle  
16. **Logs / Knowledge / Report / Failure Override**  
17. **Hermes 核心整合** — Skills / 持久記憶 / Prompt 分層 / 學習迴圈 / 跨會話搜尋  
18. **Hermes Phase 3** — Cron 掛載 Skills、最小 MCP client（HTTP/stdio）  
19. **跨平台** — Electron + electron-builder（macOS / Windows）+ `npm run smoke`  
    詳見 `docs/HERMES_INTEGRATION_PLAN.md`
20. **Pydantic AI 2.0 Capability 全套** — capability 原語（instructions+tools+model settings 打包）、
    漸進式披露（`load_capability`）、**Tool Search**（工具過多先藏、關鍵字檢索解鎖）、
    **CodeMode**（`run_code` Worker 沙箱批量工具呼叫）、capability 宣告式人類審批  
    詳見 `docs/PYDANTIC_AI_V2_CAPABILITIES.md`

詳見 [`app/README.md`](./app/README.md)。
