# OpenCode → SubAgents 概念整合

> 來源：[anomalyco/opencode](https://github.com/anomalyco/opencode)（MIT）  
> 本專案為**概念對齊的獨立 TypeScript 實作**，不 fork 其 monorepo / TUI。

## 1. 取用的核心

| OpenCode | 本專案對應 |
|----------|------------|
| Primary **build** / **plan**（Tab 切換） | `AgentMode`：`build` \| `plan`，UI chips + Tab（空輸入）+ `/build` `/plan` |
| Plan 限制寫入／危險操作 | `permission`：edit / web 等 `allow` \| `ask` \| `deny` |
| Subagents `@general` `@explore` | 訊息內 `@mention` → 隔離子代理或唯讀工具集 |
| 模型無關 | 既有對話 **model** + **thinking depth** |
| Session | 既有 **Threads** |
| AGENTS.md /init | 既有 `/init` |

## 2. 本期已補

| 能力 | 狀態 |
|------|------|
| 模型 + 推理強度 UI（附圖式 pill 巢狀選單） | ✅ `ModelDepthMenu` |
| 真 bash（Electron `shell:bash`） | ✅ 工具 `bash` |
| 掃描 `~/.config/opencode/agents/*.md` | ✅ `/opencode agents` |
| opencode CLI detect / run | ✅ `/opencode` `/opencode run` |
| ask 權限 HITL 彈窗 +「代我核准」 | ✅ `PermissionAskModal`（bash 預設 ask） |
| 專案目錄 + Git worktree | ✅ `ProjectContextBar`（本機 / GitHub / 分支） |
| CLI 授權 → 動態模型／推理深度 | ✅ 設定 → **CLI 授權** · `cliProviders` |

### 仍簡化

- **完整互動 TUI / node-pty 模擬器**：本機跑 `opencode` TUI；App 內 `bash` + 一次性 CLI  
- OpenCode Zen 訂閱完整模型目錄同步  

## 3. 檔案

```
app/src/agent/opencode/
  agents.ts
  permissions.ts
app/src/components/ModelDepthMenu.tsx
app/src/components/PermissionAskModal.tsx
app/electron/shellBridge.ts
app/electron/opencodeBridge.ts
```

## 4. 授權

- OpenCode：MIT（Anomaly / SST）  
- UI 與文件標註「靈感來自 OpenCode」  
