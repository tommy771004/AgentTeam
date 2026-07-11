P0：必須優先修正
排程綁定的 project 不一定是工具實際操作的 project
projectRoot 有傳給 prompt/AGENTS，但 function-calling、workspace、bash、MCP 仍可能讀取 UI 目前選取的全域 project。當排程綁定 A、使用者正在看 B 時，存在工具操作 B 的風險。
相關位置：[toolLoop.ts (line 201)](D:/Project/github/AgentTeam/app/src/agent/tools/toolLoop.ts:201)、[runDispatch.ts (line 84)](D:/Project/github/AgentTeam/app/src/agent/runDispatch.ts:84)、[executor.ts (line 42)](D:/Project/github/AgentTeam/app/src/agent/tools/executor.ts:42)。
**狀態（2026-07-11 實作）**：✅ `runContext.setRunProjectRoot` per-run pin；toolLoop/executor/bash/workspace IPC 優先用 run pin；Electron `resolveWorkspacePath(rel, rootOverride)`。
UI 選擇的 Loop 沒有完整傳進 controller
Composer 和 slash 執行時沒有傳 loopType，而 controller 預設強制為 Goal-based。因此 Turn-based、Time-based、Proactive 在一般 UI 任務中可能只是畫面選擇，沒有真正控制 engine。
相關位置：[ProtocolsPage.tsx (line 289)](D:/Project/github/AgentTeam/app/src/pages/ProtocolsPage.tsx:289)、[useSlashExecutor.ts (line 51)](D:/Project/github/AgentTeam/app/src/hooks/useSlashExecutor.ts:51)、[runExternal.ts (line 270)](D:/Project/github/AgentTeam/app/src/agent/runExternal.ts:270)。
**狀態**：✅ composer / slash 傳 `loopType`（thread 或 selectedLoopType）。
beforeRun hook 拒絕會切斷整個完成流程
被 hook deny 後直接 return，沒有：
onSettled
afterRun
Archive
queue drain
排程可能一直維持 running，後面的佇列也可能不補跑。
相關位置：[runExternal.ts (line 352)](D:/Project/github/AgentTeam/app/src/agent/runExternal.ts:352)。
**狀態**：✅ deny 路徑改為 afterRun + onSettled + drain。
工具失敗仍可能顯示任務成功
Goal／Turn 的完成判定主要看 step 是否 COMPLETED，沒有可靠納入 toolCall.ok。Heuristic 路徑工具被拒絕時甚至不建立 ToolCallRecord，LLM 失敗也會轉為 simulation，最後仍可能產生正式 success、對話結果與 Archive。
相關位置：[engine.ts (line 843)](D:/Project/github/AgentTeam/app/src/agent/engine.ts:843)、[engine.ts (line 970)](D:/Project/github/AgentTeam/app/src/agent/engine.ts:970)、[engine.ts (line 1184)](D:/Project/github/AgentTeam/app/src/agent/engine.ts:1184)。
**狀態**：✅ 步驟內全部 tool 失敗 → step FAILED + 低 confidence；heuristic deny 寫入 ToolCallRecord。
CLI 路徑的狀態與 trace 沒有對齊
CLI 未授權等 dispatch 前置失敗時，controller 仍使用全域 Agent state 更新 thread，可能顯示舊結果或 idle。CLI 也沒有承接 controller 的 runId 與 loop type，而會自行產生 cli_* 並固定為 Goal-based。
相關位置：[runDispatch.ts (line 119)](D:/Project/github/AgentTeam/app/src/agent/runDispatch.ts:119)、[runExternal.ts (line 396)](D:/Project/github/AgentTeam/app/src/agent/runExternal.ts:396)、[localCliRun.ts (line 93)](D:/Project/github/AgentTeam/app/src/agent/localCliRun.ts:line 93)。
**狀態**：✅ dispatch 失敗用 result.error 更新 bubble；CLI 帶 runId + loopType 進 agent state；controller 優先採用 dispatch 結果。
無人值守 MCP 寫入操作可能沒有 HITL
full 雖會降為 auto，但動態 MCP 工具未全面具備 side-effect/approval 宣告。排程或 Webhook 有機會自動執行 MCP 寫入、刪除操作。
相關位置：[toolGuard.ts (line 50)](D:/Project/github/AgentTeam/app/src/agent/tools/toolGuard.ts:50)、[runtime.ts (line 73)](D:/Project/github/AgentTeam/app/src/agent/capabilities/runtime.ts:73)。
**狀態**：✅ write-like MCP 名稱強制 needAsk（unattended 走逾時 auto-deny）。
P1：工作流仍有斷鏈
Background delegate 沒走 runTask，也沒有繼承 runId、sourceKind、projectRoot；背景模式還遺失 inheritCapabilities。[backgroundJobs.ts (line 150)](D:/Project/github/AgentTeam/app/src/agent/hermes/backgroundJobs.ts:150)
**狀態**：✅ 背景委派走 `runTask(sourceKind=delegate)`（busy 時 enqueue）；同步 leaf 仍用 runDelegatedTask 但繼承 parentRunId/projectRoot/sourceKind/inheritCapabilities。
Schedule 正常完成時可能執行兩次 settleJob。[App.tsx (line 98)](D:/Project/github/AgentTeam/app/src/App.tsx:98)
**狀態**：✅ 移除成功路徑第二次 settleJob（只靠 onSettled）。
Queue 滿 24 筆會靜默丟棄最舊項目，沒有 settle 被丟棄的排程。[runQueue.ts (line 321)](D:/Project/github/AgentTeam/app/src/agent/runQueue.ts:321)
**狀態**：✅ drop 時呼叫 onSettled(cancelled)。
Telegram queued 任務補跑完成後，不會回覆原本 chat。[App.tsx (line 319)](D:/Project/github/AgentTeam/app/src/App.tsx:319)
**狀態**：✅ onSettled 統一回覆（含 queue drain）。
關閉 Webhook 設定時沒有停止既有 listener/server。[App.tsx (line 151)](D:/Project/github/AgentTeam/app/src/App.tsx:151)
**狀態**：✅ webhookEnabled=false 時 stop()。
afterTool hook 只接 function-calling；heuristic 工具沒有 afterTool。[engine.ts (line 843)](D:/Project/github/AgentTeam/app/src/agent/engine.ts:843)
**狀態**：✅ heuristic 路徑也 fire afterTool。
OpenCode instructions 使用全域單一 store，不依每次 run 的 pinned project 解析，快速切換 project 或排程執行可能錯配。[opencodeConfigStore.ts (line 93)](D:/Project/github/AgentTeam/app/src/store/opencodeConfigStore.ts:93)
**狀態**：✅ `instructionsByRoot` 快取；`temporaryInstructionsNote(projectRoot)`；engine 依 run pin hydrate/套用。
AGENTS hierarchy 目前只從 project root 向上三層，沒有依實際工作檔案載入子目錄 AGENTS。[main.ts (line 932)](D:/Project/github/AgentTeam/app/electron/main.ts:932)
**狀態**：✅ `project:agentsDocs(root, workPath?)` 由 workPath 向上收集 subdirectory AGENTS 再加 parent。
Tool package 的 read 分類未驗證 HTTP method；標為 read 的 POST/DELETE 可能免重審執行。[toolPackage.ts (line 65)](D:/Project/github/AgentTeam/app/src/agent/tools/toolPackage.ts:65)
**狀態**：✅ validate + effectiveOperationClass 將 read+POST/PUT/PATCH/DELETE 視為 write。
Package health function已存在，但沒有任何 production caller。[toolPackage.ts (line 197)](D:/Project/github/AgentTeam/app/src/agent/tools/toolPackage.ts:197)
**狀態**：✅ `approveToolPackage` 核准時呼叫 `runToolPackageHealth`。
入口對齊狀態
入口	Controller	Project/context	完成回寫	判定
Composer／Slash	有	✅ loopType + run pin	✅	對齊
Schedule	有	✅ 工具用 pin project	✅ 單次 settle	對齊
Webhook	有	部分	部分	✅ 關閉停服
Telegram	有	部分	✅ queued 回覆	對齊
Local CLI	有 dispatch	CLI cwd + runId/loop	✅	對齊
Delegate	✅ runTask（背景）/ 同步 leaf 繼承上下文	✅ pin + inheritCaps	✅ Archive	對齊改善

實際驗證結果
npm run build：通過。
**CI（2026-07-11）**：✅ `.github/workflows/ci.yml` — matrix `ubuntu-latest` + `windows-latest`：`npm ci` → oxlint → `build` → `smoke:ci`（含 scenario E2E + production-module 真源碼 import）→ `smoke:built`。Marketplace E2E 另 job、`continue-on-error`（Electron/CJS 歷史脆弱）。
**Production modules smoke**：✅ `scripts/smoke-prod-modules.mts` 直接 import 真源碼 `runContext` / `toolPackage` / `platformProcess`（非 smoke mirror）；`hooks` 因 bundler 無副檔名 import 改為 source contract 斷言。接進 `smoke` / `smoke:ci`。
完整 React store/engine 驅動的 production E2E 仍為可選後續（需 browser/Electron harness）。
