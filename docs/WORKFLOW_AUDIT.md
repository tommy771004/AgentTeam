# 工作流稽核報告(Agent 視角)

> 稽核日期:2026-07-11 · 範圍:`app/` 全部執行路徑
> 方法:以 agent 執行者視角,從六個觸發入口逐段追蹤到產出/歸檔/學習回饋,
> 驗證每個功能是否有對應的上游觸發與下游消費者(不能有「做了但沒人用」或「用了但沒人做」)。

---

## 1. 工作流全景

```
觸發入口(6)                    統一管線                          產出與回饋
─────────────                ─────────────                      ─────────────
UI 對話 (ProtocolsPage) ─┐
斜線指令 (useSlashExecutor)─┤
排程到期 (SchedulerBootstrap)┤→ taskRunCoordinator.runTask
Webhook (WebhookBootstrap) ─┤   capacity/attachments/thread/beforeRun
Telegram (GatewayBootstrap)─┤   → dispatchThreadTask(snapshot)
背景委派 (backgroundJobs) ──┘        ├→ builtin: agentEngine (loop)
                                     └→ cli: localCliRun (external)
                                                ▼
                              finalizeTaskRun（summary→afterRun→Archive→onSettled→release→drain）
                              4 patterns: Turn / Goal / Time / Proactive
                                （Time/Proactive 僅 automation trigger）
                              每步 executeStepWithAgent:
                                ├─ FC 路徑: toolLoop + ContextPacket + capability
                                ├─ heuristic 路徑: 關鍵字選工具 + capability runbook/審批
                                └─ 模擬路徑: 無 LLM
                                                ▼
                              產出: state.result → Archive(一次)
                              回饋: learningLoop → 技能草稿/記憶
                              通知: 桌面 notify / Telegram 回覆 / 排程狀態回寫
```

**並行語意（2026-07 更新）**: 預設單 run（`concurrentRunsEnabled=false`）；opt-in 後以 `runId` registry + `maxConcurrentRuns` 上限並行。忙碌時 automation **queue**、互動 **steer/queue**（非永久跳過）。詳見 ADR-0003 與 `TASK_AGENT_WORKFLOW_INTEGRATION_PLAN_2026-07-14.md`。

---

## 2. 已驗證的互相呼應關係

| # | 功能 A → 功能 B | 驗證錨點 |
|---|---|---|
| 1 | 排程 job 的 `skillNames` → Task run `attachedSkills` → FC preload `skill:*` capability | `App.tsx` → `taskRunExecution.ts` → `engine.ts` |
| 2 | 事件源(webhook/排程/TG)→ `eventPreMatched` → Proactive 跳過謂詞重查 | `App.tsx:131` → `engine.ts` `runProactive` |
| 3 | 無人值守來源 → `unattended: true` → HITL 45s 逾時自動拒絕(工具 ask + safety intervention 皆有計時器) | `App.tsx:49,134,225` → `toolGuard.ts:87` / `engine.ts:234-254` |
| 4 | Capability 載入狀態跨步驟延續(step N 載入 → step N+1 preload 還原) | `engine.ts:559-562` `preloadCaps` 併入 `state.loadedCapabilityIds` |
| 5 | Heuristic 路徑也吃 capability:runbook 注入、`approvalRequiredFor` 強制審批、自動 load 所選工具的所屬包 | `engine.ts:645-705` |
| 6 | `approvalTools` 宣告(bash / run_code)→ `forceAsk` → allow-pattern 不可繞過 | `builtins.ts` → `toolGuard.ts` |
| 7 | run_code 內部工具呼叫 → 同一條 capability gate + authorizeTool + supervisor 限制,審計記錄 `run_code›<tool>` | `toolLoop.ts` RUN_CODE 分支 → `codeMode.ts` RPC |
| 8 | Tool Search 解鎖 → 未載入包自動 load 並附 runbook;大型 MCP 包(>8 工具)load 時保持隱藏改用檢索 | `runtime.ts` `searchTools` / `loadCapability` |
| 9 | leaf 委派的 `blockedTools` → capability 目錄同步剔除空包(模型不會 load 到被封鎖的包) | `runtime.ts` `assembleCapabilities(blockedTools)` |
| 10 | Compaction 保留 `tool_calls`/`tool_call_id` 鏈,邊界對齊避免孤兒 tool 訊息 | `toolLoop.ts:312-336` + `compaction.ts` `alignKeepStart` |
| 11 | 並發 HITL ask → FIFO 佇列 + 逾時自動 deny(不再互相覆蓋) | `permissionAskStore.ts` |
| 12 | 執行結束 → Archive 含 `toolCalls` / `loadedCapabilityIds` / `tokensUsed`(審計不斷點) | `agentStore.ts:411-415` |
| 13 | Export/Import bundle 含 Hermes skills/memory;secrets 匯出時遮蔽、匯入時保留本機金鑰 | `settingsStore.ts:147-180, 215-230` |
| 14 | 學習迴圈:成功 run → 技能草稿/記憶 → `skillsStore` → 下次 run 的 `skill:*` capability 目錄 | `learning.ts` → `runtime.ts` `skillCaps()` |
| 15 | Time/Proactive 的 confidence 由工具成功率推導(不再無條件 0.99/success) | `engine.ts:1069,1082` |
| 16 | Always-on 能力包 UI 涵蓋 builtin + `skill:*` + `mcp:*` | `SettingsPage.tsx:1439-1453` |
| 17 | 設定變更 live-apply 到執行中引擎 | `settingsStore.update` → `agentEngine.configure` |
| 18 | CLI runner 路徑(codex/claude/…)→ 同樣進 Archive + 學習迴圈 | `agentStore.startLocalCliExecution` |

---

## 3. 前輪缺口修復狀態(2026-07-11 複驗)

| 缺口 | 狀態 |
|---|---|
| 1. Capability 狀態不跨步驟 | ✅ 已修(engine preload 併入 loadedCapabilityIds) |
| 2. Heuristic 路徑繞過 capability | ✅ 已修(runbook + 審批 + 自動 load;漸進披露語意改為「自動載入」屬設計取捨) |
| 3. Archive/Export 遺失審計與學習資產 | ✅ 已修(ArchiveRecord 擴欄位;bundle 含 hermes;secrets 遮蔽) |
| 4. 委派與 capability 脈絡斷開 | ✅ 已修(blockedTools 目錄剔除 + `inherit_capabilities` 顯式繼承) |
| 5. Compaction 打斷 FC 訊息鏈 | ✅ 已修(鏈保留 + 邊界對齊) |
| 6. Permission ask 並發覆蓋 | ✅ 已修(FIFO + timeout) |
| 7. 無人值守 HITL 永久掛起 | ✅ 已修(unattended 45s / 互動 90s 自動 deny;safety intervention 同步有計時器) |
| 小. Time/Proactive 假 confidence | ✅ 已修 |
| 小. Always-on UI 只列 builtin | ✅ 已修 |
| 小. exportBundle 明碼 apiKey | ✅ 已修(REDACTED) |

---

## 4. 本輪殘餘缺口(依優先序) — 2026-07-11 實作狀態

### G1|Capability 狀態跨「run」不恢復 → ✅ 已修
- `thread.lastCapabilityIds` / `lastUnlockedTools` 持久化
- `dispatchThreadTask` 回灌 `preloadCapabilityIds` + `preloadUnlockedTools`
- run 結束 `setLastCapabilities`;`toolLoop` 回傳 `unlockedToolNames`

### G2|smoke 測試零覆蓋 → ✅ 已修
- `scripts/smoke-caps.mjs`:alignKeepStart / blockedTools 剔除 / approvalRequiredFor /
  tool search 隱藏 / 佇列 dedupe / codeMode fetch 禁用
- `npm run smoke` 串接兩份腳本

### G3|忙碌即跳過,無佇列 → ✅ 已修(+ 持久化)
- `runQueue.ts` FIFO(上限 24、去重);自動化忙碌時 `skipReason: 'queued'`
- run 結束 `drainExternalRunQueue`;排程 once 不再永久錯過
- **localStorage `subagents.runQueue.v1` 持久化**;`hydrateRunQueue` + `RunQueueBootstrap` 重啟後恢復並補跑
- 排程 job 以 `meta.scheduleJobId` 跨重啟 rebind `markJobResult`

### G4|委派子代理 preload → ✅ 已修
- `delegate_task.inherit_capabilities[]` 顯式繼承;基線仍為 core-utils/web-research/memory

### G5|文件與程式脫節 → ✅ 已修
- `CLAUDE.md` / `docs/PYDANTIC_AI_V2_CAPABILITIES.md` 已同步:heuristic 能力感知、
  跨 run 恢復、unattended HITL、blockedTools 目錄、佇列、fetch 禁用

### G6|觀察性小洞 → ✅ 已修
- Worker:`self.fetch` / `XMLHttpRequest` / `WebSocket` = undefined
- 背景委派完成 → `archiveBackgroundJob` 寫入 Archive
- **HITL per-run 統計**寫入 `ArchiveRecord.hitl`(allow/deny/timedOut);Records 可檢視

---

## 5. 建議處理順序(已完成)

1. ~~G6-fetch~~ ✅
2. ~~G2 smoke~~ ✅
3. ~~G1 跨 run~~ ✅
4. ~~G3 佇列~~ ✅
5. ~~G4 / G6-背景job~~ ✅

---

## 6. 第三輪稽核(2026-07-11)— 自動載入/自動帶入/工具庫 + approvalMode

前置:`AUTOLOAD_TOOLBOX_PLAN.md` 的 A1/A2/B1/B2/B3 已實作,本輪逐一驗證接線並稽核新增的
三段核准模式(approvalMode)。

### 6.1 新功能接線驗證(全部通過)

| 功能 | 驗證 |
|---|---|
| 宣告式自訂工具(A1) | FC pool 注入 + run_code 內部可呼叫 + `bash_template` 一律審批 + `source:'user'` capability + secrets 匯出遮蔽/匯入保留 + settings 覆蓋 plugin 同名工具 |
| MCP 一鍵匯入(A2) | `mcpDiscover.ts` → IPC → Settings 按鈕,匯入不含 secrets |
| 模型自動帶入(B1/B2) | `/models` 清單存 `discoveredModels` → datalist;角色槽一鍵建議 |
| approvalMode 三段模式 | composer pill + Settings 卡片;FC / heuristic / run_code 內部 / 委派全走同一 `decideApprovalNeed` |

### 6.2 本輪發現並「已修」的缺口(approvalMode 安全死角)

| 缺口 | 修復 |
|---|---|
| `always` 模式漏掉自訂工具 — custom http/bash 名稱任意,不在靜態 `SIDE_EFFECT_TOOLS` 清單,`requiresApproval:false` 的網路工具在「要求核准」下不會問 | `authorizeTool` 新增 `sideEffect` hint,toolLoop 對 custom 工具(含 run_code 內部)傳入;`decideApprovalNeed(mode, tool, base, sideEffectHint)` |
| unattended + full 無降級 — 排程/webhook/Telegram 在完整存取權下 = 無人+無限制+無 HITL | `effectiveApprovalMode`:unattended 一律 `full → auto`(log 提示);engine safety gate 的 full 直通同步限定互動 run |

驗證:`npm run build` ✓ · `npm run smoke` 9+12 全綠(新增 sideEffect 矩陣、降級矩陣、
customTools 契約 3 個測試)。

### 6.3 殘餘缺口(下輪候選)

| # | 缺口 | 優先 | 說明 |
|---|---|---|---|
| R1 | CLI runner 不映射 approvalMode | ★★ | `localCliRunner.ts:104` 只處理 plan mode;thread runner 為 codex/claude CLI 時,composer 選的核准模式無效(CLI 用自己的核准系統)。可映射:full → `--dangerously-skip-permissions`/`--full-auto`(建議僅互動 run)、always → 預設互動核准 |
| R2 | A3/A4 目標/專案感知 preload | ✅ 已修 | `runDispatch.ts` 以 keyword tool 路由反查 capability，預載 1–2 個高訊號包；project root 再預載 `codegraph` / `workspace`，無 root 不列 codegraph |
| R3 | C2/C4/C5 核心工具 | ✅ 已修 | `workspace_download`、mkdir/move/delete（delete/move capability 強制核准）與 `json_extract_lite` 正名已接 Electron bridge / executor / capability |
| R4 | 自訂工具僅 FC 路徑可用 | 註記 | heuristic 關鍵字選擇只認 registry `ToolName`;屬設計限制,文件已標明 |
| R5 | C1/C3/C6 預置範例包 | ✅ 已修 | `example-edge` 提供 git/RSS custom tool 示範；`table_parse` 提供 CSV/TSV 純函式解析 |

---

## 7. 第四輪複驗(2026-07-11)— R2/R3/R5/B4 修補驗證

### 7.1 修補接線驗證(全部通過)

| 修補 | 驗證錨點 |
|---|---|
| A3/A4 目標+專案感知 preload | `runDispatch.ts:92-104`:`selectToolsForStep` → `capabilityOwnsTool` 反查取 1–2 包;有 projectRoot 追加 `codegraph`/`workspace` |
| B4 模型感知調參 | `agent/modelTuning.ts` → `SettingsPage.tsx:326` 一鍵套用 threshold/payload/rounds |
| C2/C4 workspace 工具 | 四檔契約完整(registry/schemas/executor/builtins)+ Electron bridge(preload 8 處、main 4 handler)+ move/delete 掛 `approvalTools` |
| C5 `json_extract_lite` 正名 | 全 codebase 無殘留 `'json_extract'` 舊名引用 |
| C1/C6 範例包 | `example-edge` 外掛內建 `rss_fetch`(http_template)+ `git_status_readonly`(bash_template) |
| heuristic 路徑支援新工具 | `buildToolInput` 有對應 case |
| R1 外部 CLI approvalMode | `runDispatch` → `agentStore` → preload IPC → Electron `localCliRunner`;互動 full 僅映射 Codex `--full-auto`、Claude `--dangerously-skip-permissions`，unattended / plan / 未支援 CLI 均降回預設核准 |

驗證:`npm run build` 零錯誤 · smoke 9+15 全綠。

### 7.2 本輪發現並已修:SIDE_EFFECT_TOOLS drift(同型缺口第二次)

- **缺口**:R3 新增的 `workspace_download`(網路+寫檔)、`workspace_mkdir`(檔案編輯)
  未加入 `SIDE_EFFECT_TOOLS` — 「要求核准」(always)模式下不會先問
  (move/delete 因 capability `approvalTools` 蓋住,不受影響)。
  這與第三輪的 custom tools 漏網是**同一型缺口**:工具庫演進,靜態分類清單沒人提醒要跟上。
- **修復**:四個 workspace 寫入型工具補進 `SIDE_EFFECT_TOOLS`;`table_parse` 純函式唯讀,不列。
- **治本**:smoke 新增「**side-effect drift guard**」契約測試 —
  解析 registry 的 ToolName 聯集,每個工具必須屬於:唯讀白名單 / `SIDE_EFFECT_TOOLS` /
  capability `approvalTools` 三者之一,否則 smoke 直接紅。
  之後再加工具漏分類,`npm run dist` 會被擋下。

### 7.3 殘餘缺口

| # | 缺口 | 優先 | 說明 |
|---|---|---|---|
| R1 | CLI runner approvalMode 映射 | ✅ 已修 | 共享 `cliApproval.ts` 同時由 renderer 和 Electron 端採用；Electron 邊界再次拒絕 unattended full。Codex/Claude 若不支援 permissive flag 會安全退回預設核准。 |
| R4 | 自訂工具僅 FC 路徑可用 | 註記 | heuristic 關鍵字選擇只認 registry `ToolName`；維持既有設計限制，非安全缺口。 |

---

## 8. 第五輪複驗(2026-07-11)— R1 驗證與稽核收斂

### 8.1 R1 端到端驗證(通過)

| 檢查點 | 結果 |
|---|---|
| 決策單源 | `agent/cliApproval.ts` 一份模組,renderer(`localCliRun.ts:7`)與 Electron 主程序(`localCliRunner.ts:9`)同源引用 — 無 renderer/main 拷貝 drift 風險 |
| 傳遞鏈 | `runDispatch.ts:127-128`(approvalMode + `overrides.unattended`)→ `startLocalCliExecution` → preload IPC → main `resolveCliApproval` **雙端各解析一次**(主程序不信任 renderer 結果,邊界再驗) |
| 安全邊界 | unattended full → auto;plan mode 不給 permissive;僅 codex(`--full-auto`)/claude(`--dangerously-skip-permissions`)映射;其他 CLI 保持預設核准 |
| 降權 fallback | 舊版 CLI 不認 permissive flag 時的 fallback 指令**只會降權、不會靜默保留權限**(`localCliRunner.ts:110` 註解明示) |
| 測試 | smoke 鏡射 `resolveCliApproval` 決策矩陣;`npm run build` 零錯誤;smoke 9+16 全綠 |

### 8.2 稽核收斂宣告

五輪稽核(工作流呼應 → 自動載入/帶入/工具庫 → approvalMode → 修補複驗 ×2)後:

- **缺口簿清零**:G1–G6、R1–R3、R5、A1–A4、B1–B4、C1–C6 全部落地並經接線驗證;
  唯一留存的 R4 為明示的設計限制(自訂工具僅 FC 路徑),非安全缺口。
- **防退化機制上線**:side-effect drift guard、cliApproval/approvalMode 決策矩陣、
  佇列 dedupe、compaction 對齊等 25 個 smoke 測試把守 `npm run dist`。
- 後續新增功能時的**三個自檢問題**(取代再開一輪全面稽核):
  1. 新工具:進了唯讀白名單 / `SIDE_EFFECT_TOOLS` / `approvalTools` 哪一個?(drift guard 會擋)
  2. 新觸發入口：是否一律走 `taskRunCoordinator.runTask`，並攜帶正確的 queue／unattended／trigger evidence？
  3. 新設定欄位:types + DEFAULT + SettingsPage 三處齊了嗎?機密欄位有沒有進 export 遮蔽清單?

---

## 9. 第六輪稽核(2026-07-11)— 附件/Vision・Marketplace 連接器・OAuth・Windows

本輪外部新增了四個子系統,逐一驗證接線與安全邊界。

### 9.1 新子系統接線驗證(全部通過)

| 子系統 | 驗證 |
|---|---|
| **聊天附件 + Vision** | composer(`CommandComposer`/`AttachmentThumb`)→ Electron materialize 落盤(`filePath` 進 runQueue 持久化,重啟補跑不掉圖)→ FC 路徑組 `image_url` 多模態訊息;heuristic 路徑無 dataUrl 時降級為路徑註記並 log 提示;CLI 路徑以 text/path appendix 併入 prompt;Telegram 圖片入站也走同一 attachments 通道(`App.tsx:276-318`) |
| **per-run projectRoot** | `RuntimeOverrides.projectRoot` → engine(`:689-711`)→ executor workspace/codegraph 工具;排程多專案不再互踩 |
| **Plugin Marketplace / 連接器** | `pluginCatalog.ts` 11 家連接器(GitHub/Notion/Google Calendar/Sheets/Linear/Figma/Asana/ClickUp/Dropbox/Canva/HA)以 customTools(http_template)出貨 → 沿用 capability/審批/supervisor 全管線;**寫入型工具 9 處 `requiresApproval: true`** |
| **OAuth(device/code + PKCE)** | `pluginOAuth.ts` 供應商設定單源,renderer 與 Electron `oauthBridge.ts` 共用;loopback 固定port 19789;token 自動刷新 `startTokenRefreshScheduler` 已接 App bootstrap(`App.tsx:467`),Settings 亦可手動刷新 |
| **Windows 平台化** | `platformProcess.ts` + `executableLookupCommand`;smoke 契約測試禁止核心路徑出現 POSIX-only shell 語法;`--require-built` 模式供 CI 強制驗建置產物 |

### 9.2 OAuth secrets 三層隔離複驗(通過)

1. `pluginOAuthClients`(clientId/clientSecret)→ export 時 **clientSecret 遮蔽**,且重建物件只保留兩欄,任何誤存欄位都會被剝除
2. `customToolSecrets` → export 全鍵遮蔽(既有)
3. **連接器 token 本體**(PAT / access / refresh token)→ 獨立 `pluginSecrets` store(`subagents.plugin-secrets.v1`),**不在 settings、不在 hermes 匯出 payload**;plugin manifest 只存 `hasSecret` 布林 — 匯出 bundle 天生不含 token(換機需重新授權,屬正確安全取捨)

### 9.3 本輪發現並已修

| 問題 | 處置 |
|---|---|
| `simple-icons` 進了 package.json 但未安裝 → fresh checkout `npm run build` 直接紅(TS2307) | `npm install` 後 build 零錯誤;此類問題 build 本身即攔截,無需額外機制 |

### 9.4 小註記(非缺口)

- `pluginSecrets.ts` 開頭註解寫「Desktop: prefer hermes payload slot」,實作只用 localStorage —
  註解與程式不符;**現狀(不進 hermes payload)反而是安全上正確的**,建議改註解而非改程式。

驗證:`npm install` + `npm run build` 零錯誤 · `npm run smoke` 全綠(16 capability 測試,0 skipped)。

---

## 10. 第七輪稽核（2026-07-11）— Loop Engine × Hermes 核心

聚焦「兩類核心是否完整且真正用於任務執行」。四模式統一管線、Hermes 三路徑注入、
學習迴圈、委派隔離與意圖 preload 的既有接線維持；本輪補上語意 DoD 驗收、LLM 計畫解析、
DoD 缺口迭代回饋、目標相關記憶召回、失敗學習、無人值守 Turn-based 保護與 CJK 意圖匹配。
詳細設計與驗收點見 `docs/LOOP_HERMES_GAP_PLAN.md`。

---

*稽核方式:靜態追蹤 + 呼叫點 grep 驗證;未執行端到端動態測試。
複驗某條呼應關係時,直接以表中檔案錨點為起點。*
