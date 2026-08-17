# SubAgents AI ↔ DeepSeek Harness 差距分析與放大計畫

> 對象：`deepseek-ai/deepseek-harness`（`dsh`），分析日期 2026-08-17。
> 方法：clone `dsh` 原始碼逐包閱讀（非僅讀 README），對照 `app/src/agent/**`、`app/electron/**`、`CONTEXT.md`、`docs/adr/`。

## 前提：兩者不是同類

| | dsh | SubAgents AI |
|---|---|---|
| 定位 | DeepSeek 官方、MIT、developer preview 的**通用 agent harness 框架** | **可販售的中文桌面 agent 產品** |
| 規模 | ~520k 行 TS、2360 檔、50+ workspace packages、647 個 vitest spec | `app/` ~88k 行、386 檔、~140 個 smoke 腳本 |
| 分發 | `npx @deepseek-ai/dsh web` → `localhost:3080` | Electron 安裝包 + 簽章更新通道 |
| 核心 | Cordis plugin kernel（一切皆 plugin） | Electron + React 單體，Pi Core 遷移中 |

差距要按這個前提讀：dsh 在**框架可組合性**上領先兩個量級；SubAgents AI 在**產品治理與合規**上有 dsh 結構性沒有的東西。

**關鍵交集**：dsh 的 `packages/llm/llm-pi-ai` 使用 `@earendil-works/pi-ai` — 與 `vendor/pi` 同源。差別在於 dsh 只把 pi-ai 當成 `ctx.llm` 的**一個可替換 adapter**（其 `package.json` 自述為 "design-verification twin of dsh-llm-deepseek"）；本專案依 ADR-0023 把 Pi 四包 vendored 成**執行核心**。這個賭注方向決定了後面所有建議。

---

# 一、差距

## A. 架構層級：plugin kernel vs. 單體應用

dsh 建立在 **Cordis** 上：一切皆 plugin，包含 model adapter、tool registry、session log、agent loop 本身。註冊是可逆 effect，plugin 卸載即回收。組合是 **profile → bundle → patch** 三層 YAML 疊加，`dsh --profile web --dump-config` 印出實際 boot 的樹，任何一列都能被自己的 patch 取代。「沒有特權核心可以 patch」。

本專案**已經在往同一個方向走**：`tools/executor.ts` 現在只剩 15 行 compat shim，中央 `executeTool(tool)` switch 已刻意刪除，改由 `tools/registered/*.ts` 的 48 個**自註冊模組**（import-time `register()`）承擔——這正是 Cordis 式的註冊模型。單一事實來源是 `tools/toolDefinitions.ts`，每個 tool 宣告 `owningCapability`，孤兒 tool 因 `satisfies` 編譯失敗。

剩下的硬編碼成本在**設定**：加一個欄位仍要動 `agent/types.ts` + `DEFAULT_LLM_SETTINGS` + `SettingsPage.tsx` 三處。dsh 對應的是一列 YAML config row。ADR-0032（typed registry 渲染 explicit settings）正在處理這件事。

## B. 執行事實的來源：append-only event log vs. 分散狀態

dsh 的 `core/session` 是**唯一真實來源**：`SessionEvent` append-only log，`deriveMessages()` 投影模型歷史，並有 runtime invariant 斷言「**model-visible means logged**」。fork、resume、transcript、compaction、telemetry、持久化全是這條 stream 的衍生物，`ctx.sessions.fork(source, boundary?, childSessionId?)` 因此幾乎免費。

本專案狀態分散在 `chatHistory.ts`、`runJournal.ts`、thread 上的 `lastCapabilityIds`/`lastUnlockedTools`、localStorage、各 zustand store。ADR-0039 已定「Pi Host state is canonical」，方向一致，但目前沒有單一可重播的 log，所以 session fork、任意點回溯、trajectory 檢視都做不到。

## C. Sandbox 深度

| | dsh | 本專案 |
|---|---|---|
| Linux | `native/landlock-run` — ~300 行 C11 over kernel UAPI、musl static、self-restrict-then-exec、ruleset 跨 `execve` 繼承、**fail-closed** | `electron/cliFilesystemSandbox.ts` 探測 `bwrap` |
| macOS | — | seatbelt（`sandbox-exec`，`buildSeatbeltProfile()` 產 SBPL） |
| Windows | `sandbox-windows-acl` | 無 |
| 遠端 | `e2b` + `fs-e2b` + `subprocess-e2b` — fs 與 subprocess 共用同一執行世界，**指向遠端 sandbox 時 Bash / PTY / LSP 一起搬過去** | 無 |
| Policy 粒度 | **per-call**：`ctx.sandbox.confine(argv, policy)`；被拒後 same-turn `sandbox_permissions` 升級重試 | 全域 `settings.approvalMode` |
| 覆蓋範圍 | 所有 spawn 的 process | **僅 external CLI**（ADR-0022 明定的範圍）；builtin `bash` 是 `electron/shellBridge.ts` 的裸 `child_process.spawn` |

**要點**：`outbound/cliSandbox.ts` 的 `decideBuiltinShellUnderProtection()` 以硬編碼 `shellIsolationVerified: false` 呼叫，`required` 模式下 builtin `bash` 因此被**拒絕**而非被沙箱化。這**不是 bug** — ADR-0022 只把 filesystem sandboxing 的義務加在 external CLI 上，並明定「若 verified isolation 不可用，external CLI 執行即不可用」。要把同一保證延伸到 builtin shell，需要一份新的（或修訂的）ADR，不是直接改程式。

另：`electron/ptyBridge.ts` 自述是「soft PTY」——沒有 `node-pty`，只是持久化的 `bash -i` + stdin/stdout。dsh 的 `ctx.terminals` 是真 PTY 後端，且有六個模型面工具。

差異的本質：本專案的 approval 是**人在迴圈**的授權；dsh 是**kernel 強制**的約束。前者擋不住已授權後的越界。

## D. 程式碼理解工具的粒度

dsh：`packages/lsp`（`ctx.lsp` seam + `lsp` tool，四個 read-only 導覽 operation）、`tool-fs-search`（**打包 `@vscode/ripgrep` binary** 的 `glob` / `grep`，argv 前綴 `--no-config` 阻斷 `RIPGREP_CONFIG_PATH` 的 `--pre` 注入）、`tool-str-replace-editor`、read windowing、`fs-observation-policy`（freshness gate）。

本專案：`codegraph_*`（4 個自製結構圖工具）+ `workspace_read` / `workspace_diff`。**沒有 grep、沒有 glob、沒有 LSP** — 這是 coding agent 最高頻的工具族。

## E. Subagent 的廣度

dsh 有 **8 種 subagent provider** 在同一個 `ctx.subagents` 契約後面：`fork-in-process`、`spawn-in-process`、`in-process-driver`、`dsh-sdk`、`acp`、**`claude-code`**、**`codex`** — 它可以把 Claude Code 與 Codex 當成子 agent 驅動。控制面拆成三包：`tool-subagent`（委派）、`tool-subagent-control`（`send_message` / `interrupt_agent` / `list_agents`）、`tool-subagent-report`（child→parent，只存在於 continuable child 內）。

之上還有 `workflow` tool（模型寫 JS orchestration script 扇出子 agent，worker-thread 引擎執行）與 `ralph` tool（一個不變目標交給連續的 fresh child agent）。

本專案：`delegate_task` 單一 in-process 實作 + `DelegationBudget`。CLI provider 是**執行器**而非子 agent。

## F. 對外協定與可嵌入性

dsh：ACP server（JSON-RPC stdio）、TypeScript SDK、**Python SDK**、Typert RPC gateway、`dsh --profile headless "job"` 一次性執行。它可以被別的產品當引擎用。

本專案：Electron 產品（ADR-0046 明定 Electron-only），沒有 headless 入口、沒有 SDK、沒有對外協定。webhook / Telegram 是**入口**，不是可程式化的引擎介面。

## G. LLM provider 廣度

`agent/apiProviders.ts` **只支援 OpenAI-compatible**：`aihubmix` / `openai` / `openrouter` / `custom`。沒有原生 Anthropic Messages API、Gemini、Bedrock。Claude 與 Gemini 只能以 **external CLI runner** 身分進來（`cliProviders.ts`）——而 external CLI 正是斷層 3 的二等公民。

dsh 的 `ctx.llm` 是 seam，已有 `llm-deepseek` 與 `llm-pi-ai`；後者透過 pi-ai 的 provider catalog 讓「新 provider = 一段設定」而非改程式。**Pi Core 遷移完成後這一項會自動追平**——這是 vendoring 整個 Pi 而非只取 adapter 的直接紅利。

> 反向：`llmResilience.ts`（以 `breakerKey(baseUrl, apiProvider)` 為鍵的 circuit breaker + sliding window + cooldown → half-open probe + 重試分類退避 + `tokenEstimate` 預檢閘）比 dsh 的 `llm-retry` 完整。這一項**我們領先**。

## H. UI 的組合性

dsh 的 Web UI 本身也是 plugin 組成的（`packages/client/` 下約 35 個 `ui-*` package：`ui-trajectory`、`ui-goal`、`ui-plan`、`ui-jobs`、`ui-subagent`、`ui-permission-presets`、`ui-agent-preset`、`ui-settings-plugin-inventory`…）。本專案是 20 頁的單體 React app。

## I. 測試

dsh：647 個 spec，六套 vitest config（unit / e2e / web / snapshot / web-stress / web-perf）。
本專案：~140 個手寫 `node:assert/strict` 腳本，無斷言框架、無覆蓋率、無 perf/stress。

> 性質不同且有獨到之處：`smoke-caps.mjs`（2,465 行、~85 個測試）含大量**架構 drift guard**——「`agent/loop` 只被 `engine.ts` import」（對 fixture 與**真實檔案樹**各跑一次）、「coordinator 是唯一 ingress」、「UI 不得呼叫 `dispatchThreadTask`」、「finalization 唯一且順序固定」、「每個 registry tool 不是唯讀就必須被分類」。dsh 沒有等價物。

**但有一個真實缺陷**：`smoke.mjs` 自述 "Minimal re-implementations mirrored from source for CI without TS build" — 它**內聯重寫了 source 邏輯**而非 import 實作。它驗證的是演算法形狀，不是出貨的程式碼路徑。`smoke-caps.mjs` 沒有這個問題（真的 import），但 `smoke.mjs` 涵蓋的 scheduler 數學、supervisor 截斷、loop 分類這幾項目前是**假的綠燈**。

## J. 其他 dsh 有而本專案沒有的

- **spill**（`spill` / `spill-local` / `spill-policy` 三段 seam）：超大 tool 輸出落地成 locator + 取回指引。本專案 `supervisor.ts` 只截斷。
- **persistent terminal**：`ctx.terminals` + `terminal_open/send/read/signal/close/list` 六個 tool（每次操作驗證 initiating Agent，模型無法跨 agent 取用 terminal）。
- **hook 協定相容**：`hooks-claude-code` / `hooks-codex` 直接讀使用者現有的 Claude Code `hooks.json`。本專案的 `hooks.ts` 是自有格式。
- **session query**：`session_search` / `session_event_search` / `session_trace` / `session_event_trace` / `session_event_read`。
- **agent presets**：`agent.cordis.yml` 目錄，一個 process 內多個組態不同的 agent 並存。
- **self-referential toolset**：`cordis_define` / `cordis_run` / `cordis_inspect_*` — 模型可在執行中的 runtime 定義並掛載新 plugin。
- **i18n 制度化**：每份文件都有 `.md` / `.zh.md` / `.i18n.yaml` 三件套。

---

# 二、功能銜接與使用上的斷層

以下六個是「同一件事走完整條路」時會斷掉的地方，按痛感排序。

### 斷層 1 — Pi 遷移雙軌期（目前最貴）

`CLAUDE.md` 描述 legacy 架構（`agent/loop` + `agent/engine.ts` + renderer tool loop）；`CONTEXT.md` 描述 Pi 架構（Pi Core 擁有唯一 tool loop，SubAgents 只是 Orchestration Extension）。程式碼兩者並存——`registry.ts:selectToolsForStep` 有 `electronPiHostOwnsTools` 分支跳過 `bash`（註解已寫「Pi Host is the canonical Bash owner」），`electron/pi*.ts` 30+ 檔案，`scripts/` 40+ 個 `smoke-pi-*`。

ADR-0045 已定「透過可移除的 compatibility seam 遷移」，機制是對的；缺的是**退場時程與文件對齊**。目前同一功能有兩條執行路徑，行為可能不同（`bash` 在瀏覽器 fallback 與 Pi Host 下是兩套語意），文件與程式碼對不上，新人與 agent 都會走錯路。成本隨時間線性增加。

### 斷層 2 — 出錯後無法「回到某一步改一下再跑」

agent 產品最高頻的動作。dsh 有 `ctx.sessions.fork(source, boundary)` + `ui-trajectory` + `session_trace`。

本專案有 `rewindBridge.ts`、`runJournal.ts`、`compactionCheckpoint.ts`（ADR-0042 已定「只從 replay-safe checkpoint 重試」），但使用者面是四個分開的頁（`LogsPage` / `RecordsPage` / `ArchivePage` / `FailedPage`），沒有「從第 N 步分叉」這個動作。`sessionSearch.ts` 只給 agent 用，不是使用者的檢索面。

### 斷層 3 — External CLI 是二等公民

`CLAUDE.md` 自述：`executionKind: 'external'` 只有 run-scoped progress，沒有 Parse / DoD / iterate / continueGoal，且「CLI must not present as DoD met」。

使用者選了 CLI provider，四個 loop pattern 有三個半失效——等於降級成另一個產品。dsh 的處理方式是把 `claude-code` / `codex` 做成 subagent provider，走同一份契約：子 agent 就是子 agent，不管跑在哪個 transport。

### 斷層 4 — Progressive disclosure 對使用者是黑箱

`lastCapabilityIds` / `lastUnlockedTools` 存在 thread 上並自動重注入（跨 run resume），機制正確。但使用者**看不到**「這個 thread 現在解鎖了什麼工具」，也**不能手動鎖回去**。模型行為異常時，無從診斷是不是某個 capability 被誤解鎖。

dsh 對應的是 `ui-permission-presets`、`ui-agent-preset`、`ui-settings-plugin-inventory` 三個使用者面。

### 斷層 5 — 學習迴圈沒有出口

`hermes/learning.ts` 從成功 run 草擬 skill、`hermes/dream.ts` 整併 memory、`knowledge.ts` 抽 entity。但這些產物只留在**本機 localStorage**，無法 commit、無法分享、無法進 repo。

dsh 的 `skill-filesystem` 讓 skill 就是檔案系統上的 `SKILL.md` — 天生可版控。本專案已有 `projectBridge.ts` 能定位專案根（走訪上行 ≤3 層、遇 `.git` 停），差的只是寫出去的路徑。

### 斷層 6 — 組態不是產物

dsh：一切是 YAML config row，可 patch、可 dump、可版控、可分享。「把我配置好的 agent 給同事」= 給一份檔案。

本專案：`LlmSettings` 扁平物件 + localStorage + `settingsExport.ts`。團隊間無法複製一台配置好的 agent。

---

# 三、我們的優勢，以及怎麼放大

以下每一項都是 **dsh 結構性沒有、且以它的定位也不會做**的東西。

### 優勢 1 — 完整的「任務生命週期治理」層

`agent/taskRunCoordinator.ts` 的 `runTask` 是唯一入口，8 種 `sourceKind`（composer / slash / retry / schedule / webhook / telegram / event / delegate），`resolveBusyPolicy` 決定 automation 排隊、interactive steer，`runQueue.ts` FIFO + dedupe + persist + max 24，`runConcurrency.ts` 有上限的併發 registry（ADR-0003），以及**唯一 finalization**。

更關鍵的是 `agent/runJournal.ts` 的**當機復原 journal**（ADR-0040）：八態 `JournalStatus`、300 筆 ring buffer、**刻意同步寫入**（"so an admission/terminal marker is persisted before the coordinator can yield"）、產出 `RecoveryReport`（`marked-interrupted` / `resume-once` / `restored` / `quarantined`），`runTask` 第一件事就是 `await waitForStartupRecovery()`。只存有界 metadata，絕不含 prompt / tool payload / 憑證。

dsh 有 turn/step，但**沒有這一層**——「一個外部事件如何變成一次受管的 run、忙碌時怎麼辦、當機後那批 run 怎麼辦、誰負責收尾」在 dsh 是留給 plugin 作者的空白。它的 `schedule` 只是 session 內的 reminder；session log 雖可 replay，卻沒有 run 級別的當機語意。

**放大**：做成產品的第一螢幕。把 `SchedulerPage` + `EventsPage` + `ExecutionPage` 合併成一個 **Ops 控制台**：佇列深度、正在跑什麼、被 dedupe 掉了什麼、為什麼被 queue、剩餘併發額度、上次當機復原了哪些 run。dsh 使用者要自己寫 plugin 才有這個，而這正是「多來源自動化」的核心體驗。

### 優勢 2 — 證據型觸發（type-level fail-closed）

`LoopRequest` 的 `'time'` / `'proactive'` variant **在型別上就要求** `ScheduleTriggerSnapshot` / `EventTriggerSnapshot`——無證據的請求在型別層不可表達；`runLoop` 入口再於 runtime 拒絕一次（防型別系統被繞過）。對話文字帶 cron/event 意圖只會產生 **suggestion**（`automationSuggestion.ts`）。`eventMatcher.ts` 刻意不檢查目標文字，只從 adapter 提供的 rule + normalized payload 產生 canonical evidence。

對照 dsh：`schedule_create` 是**模型可呼叫的 tool** — 模型可以自己替自己排程。

**放大**：
1. 寫成一份可對外引用的 ADR，標題就叫「模型不能自己製造執行憑證」。ADR-0026 已保住 loop pattern，但沒把**證據不可偽造**這條單獨立為原則。
2. 把同一原則延伸到所有 side-effect 出口：`message_send`、`contentPublishing`、`paidWorkflow` 的 merge / push / deploy。每一個都要求一份非模型產生的 evidence snapshot。
3. 這是 to-B 銷售時唯一能講清楚的差異化安全故事。

### 優勢 3 — 治理棧的深度（權限的版本化與再核准）

- `tools/toolPackage.ts`：每個 plugin tool 宣告 `operationClass`（read / write / destructive / external），未核准的權限面**編譯成唯讀**，升級權限會改變 fingerprint 並**要求重新核准**。
- `modelProfile.ts`：per-model capability facts 帶 provenance（verified via probe / assumed / unknown），引擎在**呼叫失敗前**就降級（`tools:false` → heuristic path，`vision:false` → 圖片轉路徑註記）。
- `electron/secretsVault.ts`：token 只存在 main 的 safeStorage 加密檔，renderer 只見 metadata。
- `hooks.ts`：規則**只能限制或觀察**（deny / require-approval / append-context / log / notify），**沒有 allow**；`require-approval` 覆蓋 approvalMode `full`。
- `approvalModes.ts`：unattended run 自動把 `full` 降級為 `auto`。
- `entitlement.ts`：任何異常都 **fail closed to `free`**，永不拋錯、永不靜默授權。

dsh 有 sandbox 與 approval policy，但**沒有權限面的版本化與再核准**，也沒有 entitlement 邊界。

**放大**：把 `security:gates` / `release:qualification` / `smoke-evidence-ledger` 已產出的東西，做成一份**可匯出的合規報告**：誰在何時被授權跑了什麼、用了哪些憑證、動了哪些檔案、哪些 tool 因 fingerprint 變更被擋下。

### 優勢 4 — Outbound / 資料外洩控制（**dsh 完全沒有的一整個子系統**）

`agent/outbound/` 有 **21 個模組**：`outboundGate.ts`（四段 guard mode `off` / `demo` / `optional` / `required`）、`textSanitize.ts` / `imageSanitize.ts`、`sanitizedWorkspace.ts`、`evidenceLedger.ts` + `evidenceUpload.ts`、`policyStore` / `policyMerge` / `policySchema` / `policyAdmin`、`deviceEnrollment.ts`。連 LLM 呼叫都走這道閘 —— `window.subagents.llm.chat` 在 main 記錄 metadata-only 外送證據。背後是 **ADR-0004 ～ 0022 共 19 份 ADR** 的完整論述。

dsh 有 sandbox（管**程序能碰什麼**）但**沒有任何 egress / DLP 控制**（管**資料能流去哪**）。這兩件事正交，而後者才是企業採購時真正會問的問題。

**放大**：這是目前最被低估的資產。
1. 讓 Outbound 有一個**使用者面的儀表**——這次 run 送出了什麼、被遮蔽了什麼、送去哪個 provider。目前它只是後台策略。
2. 把 `evidenceLedger` 的輸出與優勢 3 的合規報告**合成同一份文件**：權限 + 外送，一次講完。
3. 考慮把 ADR-0022 的沙箱義務**延伸到 builtin shell**（見 §C）。目前 `required` 模式下 builtin `bash` 直接不可用，讓最嚴格模式的實用性受限。

### 優勢 5 — 垂直工作流（護城河）

dsh 刻意保持通用（48 個 builtin tool 中沒有一個是垂直的）。本專案的 48 個 tool 裡有 **14 個是 SubDesign 垂直**（`design_brief_update`、`design_direction_select`、`design_system_list|read|create|update`、`design_artifact_register|patch|tweak|capture|lint|export`、`design_critique_note`、`design_critique`），加上 SubDesign / OpenDesign studio、`paidWorkflow.ts` 的 Goal→Spec→Tickets→TDD→Review 狀態機（merge / push / deploy 明確不得成為自動 side effect）、`contentPublishing.ts` 的多平台排程發佈。

**放大**：把 `paidWorkflow` 的 `ArtifactEvidence` 從內部狀態變成**使用者看得到、可審可退回的交付物**——每階段一個 artifact，卡在哪一關一目了然。垂直工作流的價值在「交付物」，不在「狀態機」。

### 優勢 6 — 桌面產品形態 + 中文母語

安裝即用、簽章更新（`updateManager.ts` + `updateVerification.ts` + `updatePublicKey.ts`）、OS 級憑證儲存、OAuth bridge、Telegram / webhook 邊界、marketplace + plugin installer。dsh 是 `npx` + `localhost:3080`，沒有安裝包、沒有更新通道、沒有 OS 憑證儲存。

繁體中文的 UI / log / 文件是實質壁壘 —— dsh 有 i18n 制度，但英文優先、`.zh.md` 是衍生翻譯。

**放大**：定位寫死為「**中文團隊的 agent 工作站**」，而不是「另一個 agent framework」。不要在框架可組合性上跟 dsh 對打。

### 優勢 7 — Pi Core 的賭注方向是對的

dsh 只把 `pi-ai` 當成 `ctx.llm` 的一個 adapter。本專案 vendored 整個 Pi 四包當執行核心（ADR-0023），因此直接繼承 Pi 的 tool loop、session 模型與 extension host 成熟度，不必自己養。**Pi 的 extension host 給我們的，正是 dsh 靠 Cordis 拿到的東西**——可組合的擴充點。§G 的 provider 廣度差距也會隨遷移自動收斂。

`vendor/PI_UPSTREAM_PIN.json`（pinned v0.81.1 + tree SHA-256）+ `PI_CORE_PATCH_LEDGER.md` + ADR-0043/0044 的 gated PR 流程，是比多數 vendoring 更嚴謹的做法。

**放大**：唯一該做的是**加速收斂**。雙軌期越短越好。

---

# 四、建議行動（按 ROI 排序）

### P0 — 補斷層，成本低、痛感高

1. **統一架構敘述，宣告 legacy loop 退場**
   讓 `CLAUDE.md` 與 `CONTEXT.md` 描述同一個架構（Pi Core 為主、legacy loop 為明確標記的過渡路徑）。新增 drift-guard：新程式碼不得增加對 `agent/loop/*` 的引用點。
   檔案：`CLAUDE.md`、`CONTEXT.md`、`app/scripts/smoke-loop-parity.mts`。

2. **Session fork / rewind 的使用者動作**
   資料已在 `agent/runJournal.ts` + `electron/rewindBridge.ts` + `agent/compactionCheckpoint.ts`（ADR-0042）。缺的是「從第 N 步分叉重跑」的入口 — 在 `pages/ExecutionPage.tsx` / `pages/RecordsPage.tsx` 加動作，走 `taskRunCoordinator.runTask` 帶入截斷後的歷史。

3. **Capability 檢視 / 手動重置面板**
   `agent/capabilities/runtime.ts` 已持有 `loadedCapabilityIds` / `unlockedToolNames`。在 thread 側欄暴露清單 + 「重置解鎖狀態」按鈕。純讀既有資料，診斷價值高。

4. **Skill / memory 落檔到專案**
   `hermes/skills.ts` 目前只寫 localStorage。加一條「匯出到 `<project>/.subagents/skills/<name>/SKILL.md`」的路徑。重用 `electron/projectBridge.ts` 的專案根定位，不要新寫路徑解析。

5. **修掉 `smoke.mjs` 的假綠燈**
   改為 import 真實模組而非內聯重寫。`smoke-caps.mjs` 已證明 `.mts` + 真 import 可行，這是純搬運。涵蓋：`scheduler.ts` 的 `computeNextRun`、`supervisor.ts` 的截斷 / halt、`parser.ts` 的 `classifyLoopType`、`eventMatcher.ts`。

### P1 — 補能力差距，中成本

6. **`workspace_grep` / `workspace_glob`**
   走**現行**註冊模式（非 `CLAUDE.md` 描述的舊四點契約）：`tools/toolDefinitions.ts` 加定義 + `owningCapability: 'workspace'` → 新增 `tools/registered/workspaceGrep.ts` / `workspaceGlob.ts` 自註冊 handler → `electron/workspaceFs.ts` 加 IPC。`registry.ts` / `schemas.ts` 是派生視圖不需手改；`executor.ts` 已是 shim，**不要**加 switch case。
   若採 ripgrep binary，argv 需前綴 `--no-config`（見 §D）。
   順帶修正 `CLAUDE.md`「Adding a tool touches: registry.ts / schemas.ts / executor.ts / builtins.ts」這段已過期的敘述。

7. **大輸出 spill 取代截斷**
   `agent/supervisor.ts` 目前只截斷 payload。改為落地至 `electron/attachmentStore.ts` 並回傳 locator + 取回指引。同時降低 token 消耗與資訊遺失。

8. **External CLI 升格為 subagent 契約**
   讓 `agent/cliAdapters.ts` / `agent/localCliRun.ts` 走 `hermes/delegate.ts` 的契約，至少實作 continueGoal 的 prompt contract，使 `executionKind: 'external'` 能參與 Goal-based 迴圈。`CLAUDE.md` 已標為待辦。

9. **評估把沙箱義務延伸到 builtin shell**（**需先寫 ADR**）
   `electron/cliFilesystemSandbox.ts` 的 seatbelt / bwrap profile builder 已存在，技術上可套到 `electron/shellBridge.ts` 的 spawn 路徑，`shellIsolationVerified` 改由真實探測結果餵入。
   但 ADR-0022 目前只把義務加在 external CLI 上 —— 這是**範圍決策**，改動前需一份修訂 ADR 說明為何 builtin shell 也該納入，以及 Windows 無 backend 時的 fallback 語意。

### P2 — 策略性

10. **Headless 入口**
    讓 `taskRunCoordinator.runTask` 可在無 UI 的 Node 環境被呼叫（`llm.ts` 的 `setLlmTransport` seam 與現有 smoke 已證明核心邏輯可脫離 renderer）。這是可嵌入性與評測能力的**共同前提**。
    注意與 ADR-0046（Electron-only 產品）的關係：headless 是**開發 / 評測入口**，不是第二個產品形態。

11. **評測 harness**
    兩邊都沒有真正的 benchmark（dsh 的 `BENCHMARK.md` 只有兩句話，指向 Python SDK + `jsonrpc-agent`）—— 這是一塊**雙方都空著的地**。有了 10 之後，用既有的 `runJournal` + `artifactIndex` 做批次任務評分。

---

# 五、驗證方式

改動走既有管道，不新增測試框架：

```bash
cd app
npm run build          # tsc -b && vite build — 當作 typecheck
npx oxlint src
npm run smoke          # smoke.mjs + smoke-caps.mjs（含 drift guard）
npm run smoke:ci       # 完整 smoke 套組
```

| 項目 | 驗收 |
|---|---|
| 1 | 故意引入一筆 `agent/loop/*` 引用時 `npm run smoke` 應失敗 |
| 2 / 3 | `npm run smoke:coordinator` 驗證 fork 後的 run 仍走唯一 finalization；`npm run dev` 下手動確認側欄顯示與重置 |
| 4 | 新增 smoke 驗證寫出路徑落在專案根且不逃逸（沿用 `smoke-sanitized-workspace.mts` 的路徑斷言模式） |
| 5 | 改寫後 `npm run smoke` 須仍全綠；反向驗證：刻意改壞 `computeNextRun`，改寫前 smoke 照樣通過（證明沒在測真的），改寫後應失敗 |
| 6 | `npm run smoke:tool-registry`（會抓 orphan tool）+ `smoke-tool-invocation.mts`；`smoke-caps.mjs` 的「每個 registry tool 不是唯讀就必須被分類」guard 亦涵蓋 |
| 7 | `npm run smoke` 的 supervisor 邏輯測試 + 手動大輸出案例確認回傳 locator |
| 8 | `npm run smoke:loop-parity` 應證明 external 與 builtin runner 在 continueGoal 上行為一致 |
| 9 | 沿用 `smoke-cli-sandbox` / `smoke-cli-main-sandbox` / `smoke-cli-filesystem-sandbox.mts` 的真實 probe 模式；`smoke:outbound-shell-evidence` 應顯示 `required` 下 builtin bash 為「隔離執行」而非「拒絕」 |
| 10 | 新 Node 入口以一支 headless smoke 跑完一次 Turn-based run；`npm run smoke:prod` 確認未把 renderer-only 模組拉進 Node 路徑 |
| 11 | 批次跑一組固定任務，輸出可比較的 `runJournal` + `artifactIndex` 摘要；先求可重跑，再求指標設計 |
