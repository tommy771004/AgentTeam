# 四大 Agent UI 整合（靈感：CloudCLI / claudecodeui）

> 參考：[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)（AGPL-3.0）  
> 本專案為**概念對齊的獨立 TypeScript 實作**，不複製其原始碼／不 fork 其二進位。

## 1. claudecodeui 架構摘要

| 能力 | CloudCLI 做法 | 本專案對應 |
|------|---------------|------------|
| 多 Agent CLI | Claude Code / Cursor CLI / Codex（+ Gemini/OpenCode） | Provider 適配層：人格、預設模型、循環、工具偏好 |
| Session 管理 | 多 session 列表、恢復歷史 | **Thread 分欄** + localStorage 持久化 |
| 聊天介面 | 單一聊天窗串流 | Codex 風格 composer + 對話泡泡 |
| 執行回饋 | 不強制換頁、activity 指示 | **內嵌 Run 面板**（步驟／日誌／進度） |
| 檔案／Git／Shell | 內建 explorer / git / pty | 既有 Workspace + 小視窗（後續可加深） |
| 設定同步 | 讀寫 `~/.claude` 等 | 本機 `settings` + 工作區（桌面優先） |

### 刻意不做（本期）

- 直接 spawn 本機 `claude` / `cursor-agent` / `codex` / `gemini` CLI 長連線（需 PTY、權限與授權綁定）  
- 掃描 `~/.claude/projects` 還原第三方 session  
- AGPL 原始碼搬運  

本期以 **統一 UI + Provider 適配 + 多 Thread + 內嵌執行** 對齊產品體驗。

## 2. 本專案資料流

```
ThreadSidebar ──► activeThreadId
       │
       ▼
  Chat + Composer ──► startExecution(stay: true)
       │                    │
       │                    ▼
       │              agentEngine (單一執行核心)
       │                    │
       └──────────► InlineRunPanel (steps / logs / progress)
```

## 3. 對話設定（取代品牌 Provider）

**不再**以 Claude / Cursor / Codex / Gemini 分產品入口。

統一一個 Agent 介面，每則 Thread 可設：

| 設定 | 說明 |
|------|------|
| **模型** | 任意 OpenAI 相容 model id（可 `/model` 或 UI） |
| **思考深度** | `fast` / `standard` / `deep` / `max` → 迭代次數、工具回合、推理指引 |

對應：`app/src/agent/thinking.ts`、`ConversationSettings` 元件。

## 4. 授權

- claudecodeui：AGPL-3.0 — **不可**直接貼入本 repo 原始碼  
- 文件與 UI 標註「靈感來自 CloudCLI / claudecodeui」  
