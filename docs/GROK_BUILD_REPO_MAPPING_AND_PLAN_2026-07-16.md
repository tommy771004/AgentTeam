# Grok Build (xai-org/grok-build) 原始碼分析與參考整合計畫

> **狀態:** Phase 0–5 核心已落地(2026-07-16;見下方進度表)。
>
> | Phase | 內容 | 狀態 |
> |---|---|---|
> | 0 | G1 LLM retry/breaker + G3 token 估算/preflight | ✅ 完成 |
> | 1 | G2 三層 pruning + memory flush + checkpoint + context meter | ✅ 完成 |
> | 2 | G4 bash 段級權限 + 危險清單 + permissionDenied hook | ✅ 完成 |
> | 3 | G5 rewind 快照回捲 + G6 memory decay/staleness/dream | ✅ 完成 |
> | 4 | G8 plan mode + G7 hook 事件擴充/專案 hooks folder trust | ✅ 完成 |
> | 5 | G9 capability_mode/persona/resume_from/worktree + G10 wait 原語/monitor + G11 本地指標與匯出 UI | ✅ 完成 |
>
> Phase 5 遞延項已於同日補齊:persona overlay(Settings→角色模型管理)、
> `resume_from`(接續已完成背景委派)、worktree 隔離
> (`project:worktreeCreate/Apply/Remove`,apply 走 `git apply --3way`
> 衝突即失敗不覆蓋)、`monitor` 工具(每行輸出 → source=monitor 的
> Proactive 事件,音量控制自動停止)、Settings→資料控制 的指標匯出。
> **基準:** 2026-07-16;grok-build commit `c68e39f`(Publish harness and TUI open-source);本專案 branch `claude/grok-repo-analysis-2bafr8`。
> **範圍:** 比對 grok-build 的 agent runtime 設計與本專案(SubAgents AI, `app/`)的差距,列出值得移植的機制與分階段計畫。
> **不在本計畫內:** 移植 Rust 程式碼本身、TUI/終端渲染層、ACP editor 整合、行動端。

---

## 1. 分析對象概述

**Grok Build** 是 xAI 開源的終端 AI coding agent(Rust,約 60+ crates),定位等同 Claude Code / Codex CLI:全螢幕 TUI + headless + ACP 三種入口,共用一個 agent runtime。與本專案同屬「單一 lifecycle、工具迴圈、HITL 審批、記憶/技能/外掛」的 agent harness,因此其子系統可直接逐一對照。

值得注意的架構原則(與本專案 ADR 方向一致,可引為佐證):

- **單一 lifecycle seam**:`xai-agent-lifecycle` 明訂「contributors 收到 data-only 的 per-hook 輸入;要做事只能透過 install 時注入的 capability;永遠不擁有 loop control」——與我們 `taskRunCoordinator` 的唯一 finalization 原則相同。
- **純邏輯抽核心**:`xai-grok-compaction` 是 transport-agnostic 的 compaction-core,host 只負責 trigger/持久化;`xai-grok-subagent-resolution` 把 subagent 設定解析抽成純函式庫。本專案的 smoke(純邏輯)測試策略適合這種切法。
- **工具移植傳統**:grok-build 自己也 in-tree 移植了 openai/codex 與 sst/opencode 的工具實作——與我們 `agent/opencode/` 的做法同路。

### 1.1 Repo 對照表(grok-build → 本專案錨點)

| grok-build | 內容 | 本專案對應 | 現況 |
|---|---|---|---|
| `xai-grok-shell` | agent runtime + 入口 | `agent/taskRunCoordinator.ts`、`engine.ts` | ✅ 已對齊 |
| `xai-grok-tools` | 工具實作 | `agent/tools/*` | ✅ 已對齊 |
| `xai-grok-config` permission rules | deny > ask > allow、多 scope 合併 | `opencode/permissions.ts`、`toolGuard.ts` | ⚠️ 部分(見 G4) |
| `xai-grok-hooks` / `xai-hooks-plugins-types` | 14 種 lifecycle event、folder trust | `agent/hooks.ts`(4 個 hook point) | ⚠️ 部分(見 G7) |
| `xai-grok-memory` | hybrid search + decay + flush/dream | `hermes/memory.ts`、`sessionSearch.ts` | ⚠️ 部分(見 G6) |
| `xai-grok-compaction` + `[compaction.pruning]` | 分層 prune + checkpoint + memory flush | `opencode/compaction.ts` | ⚠️ 部分(見 G2) |
| `rewind_points.jsonl` + `xai-hunk-tracker` | 檔案快照 rewind、agent/external 歸因 | 無 | ❌ 缺(見 G5) |
| `xai-circuit-breaker` | LLM/HTTP sliding-window breaker | `agent/llm.ts`(無 retry/breaker) | ❌ 缺(見 G1) |
| `xai-token-estimation` | bytes/4 單一來源 + context meter | `supervisor.ts`(僅 payload byte 限制) | ❌ 缺(見 G3) |
| Plan mode(`plan.md` 唯一可寫) | 規劃/實作分離狀態機 | 無 | ❌ 缺(見 G8) |
| `spawn_subagent`(capability_mode / persona / resume_from / worktree) | 委派升級 | `hermes/delegate.ts`(blockedTools + budget) | ⚠️ 部分(見 G9) |
| `monitor` 工具 + `wait_*` 原語 | 背景事件流 | `hermes/backgroundJobs.ts`、`scheduler.ts` | ⚠️ 部分(見 G10) |
| `xai-grok-sandbox`(Landlock/Seatbelt) | OS 核心層隔離 | 無(Blob Worker 僅涵蓋 CodeMode) | 🅿 暫緩(見 §4) |
| `xai-codebase-graph`(tree-sitter) | code graph | `electron/`(codegraph bridge)、`codegraphClient.ts` | ✅ 已有基礎 |
| OTel metrics/events(`ai.xai.grok_code`) | 用量觀測 | 無 | ⚠️ 低優先(見 G11) |
| Plugin marketplace / skills / AGENTS.md 探索 | 外掛與規則 | `hermes/plugins.ts`、`skills.ts`、`projectContext.ts` | ✅ 已對齊 |

---

## 2. 本專案已達 parity、無需動作的部分

先明確列出「不必做」,避免計畫膨脹:

1. **單一 run lifecycle + queue + steer** —— `taskRunCoordinator` 的 busy policy(queue/steer)等價於 grok 的 prompt-queue + interjection;不需重做。
2. **Progressive disclosure / Tool Search / CodeMode** —— grok-build 沒有等價物;這是本專案領先項。
3. **Trigger 紀律** —— 「Time-based 只能由 claimed ScheduledJob、Proactive 只能由 event 證據」比 grok 的 `/loop` 更嚴格,保留。
4. **Secrets vault、tool package operationClass、model profiles** —— grok 對應能力(managed config、模型 capability)沒有更好,保留現狀。
5. **Skills / plugins / AGENTS.md 探索** —— 兩邊同構(SKILL.md、frontmatter、qualified name、marketplace),已對齊。
6. **Unattended 降級**(`full` → `auto`、timeout auto-deny)—— grok headless 的「would-prompt 即取消」語意相同。

---

## 3. 缺口清單與採納建議

優先序:P0 = 低成本高回報、直接補穩定性;P1 = 中型功能,補產品力;P2 = 大型/可選。

### G1(P0)LLM 呼叫韌性:retry + circuit breaker

- **grok 做法:** `xai-circuit-breaker` —— sliding window,`sample_count >= min_samples && error_rate >= threshold` 才 trip;client/server 共用同一狀態機。
- **本專案現況:** `agent/llm.ts` `chatCompletionWithTools` 無 retry、無 backoff、無 breaker;一次 429/5xx 就讓整個 step 失敗,長跑 Goal loop 與 unattended 排程 run 特別脆弱。
- **建議:** 在 `llm.ts` 加一層純函式 `withResilience`:(a) 對 429/5xx/network error 指數退避重試(2s/4s/8s,尊重 `Retry-After`);(b) per-provider breaker(視窗 60s、min_samples 5、error rate ≥ 0.5 即 open,half-open 探測);open 時 fail-fast 並讓 engine 走 degrade(heuristic/simulation)而不是卡住。breaker 狀態進 run log 供稽核。
- **觸及:** `agent/llm.ts`、`agent/types.ts` + `DEFAULT_LLM_SETTINGS`(閾值設定)、`SettingsPage.tsx`;smoke 加純邏輯測試(breaker 狀態機)。

### G2(P0)Compaction 升級:分層 pruning + checkpoint + memory flush

- **grok 做法:** 三層互補 —— (1) **tool-result pruning**:最近 `keep_last_n_turns=3` 之內不動;舊 tool result 超過 `soft_trim_threshold=4000` chars 就頭尾各留 1500 截中間;超過 `hard_clear_age_turns=10` 直接換 placeholder。(2) **pre-compaction memory flush**:接近 compact 閾值前 4000 tokens,先用 LLM 把重要脈絡寫進 memory(上限 8000 chars、semantic dedup 0.92)。(3) **compaction checkpoint**:壓縮前狀態存 `compaction_checkpoints/` 可回放;壓縮後自動查 memory 補回可能被丟掉的相關脈絡。
- **本專案現況:** `opencode/compaction.ts` 已會保 tool-call chain 對齊 + LLM 摘要 + `cfg.prune`,但沒有「舊 tool result 分層截斷」(這是最便宜的省 token 手段)、沒有壓縮前 flush、沒有 checkpoint。
- **建議:** 分兩步。**G2a**:在 compaction 前加純函式 `pruneToolResults(messages, cfg)` 實作三層截斷(soft-trim 頭尾保留、hard-clear placeholder、近 N turn 豁免),放 `opencode/compaction.ts` 或獨立 `agent/contextPruning.ts`;**G2b**:compact 觸發前呼叫 `hermes/memory.ts` 寫入 flush 摘要(重用 `learning.ts` 的 LLM 摘要路徑),compact 後把 thread 相關 memory 重新注入 ContextPacket。checkpoint 以 thread 附件形式存壓縮前訊息(localStorage 有量限,走 Electron `settings`/檔案 IPC)。
- **觸及:** `opencode/compaction.ts`、`hermes/memory.ts`、`hermes/contextPacket.ts`、`tools/toolLoop.ts`(觸發點);smoke:pruning 對齊數學(不可切斷 tool-call chain —— 沿用現有 `alignKeepStart` 保證)。

### G3(P0)Token estimation 單一來源 + context meter

- **grok 做法:** `xai-token-estimation` 是唯一出處:bytes/4 啟發式 + 衍生顯示運算,`/context`、`/session-info`、auto-compact gate、preflight overflow check、所有 renderer 都用它。
- **本專案現況:** `supervisor.ts` 用 payload byte 限制,`compaction.ts` 用 char weight,兩套度量;UI 沒有 context 使用率;compact 觸發憑感覺閾值。
- **建議:** 新增 `agent/tokenEstimate.ts`(純函式:`estimateTokens(text) = ceil(bytes/4)`、message/transcript 累計、佔 model `contextWindow` 百分比),供 (a) auto-compact gate、(b) 呼叫前 preflight overflow(超過就先 compact 再送,避免 API 400)、(c) thread UI 的 context meter(類 `/session-info`)。model `contextWindow` 掛在 `modelProfile.ts`(已有 per-model facts 機制,加一個欄位即可)。
- **觸及:** 新檔 `agent/tokenEstimate.ts`、`modelProfile.ts`、`toolLoop.ts`、`opencode/compaction.ts`、thread UI 元件;smoke:估算與 gate 純邏輯。

### G4(P0)Bash permission 匹配強化

- **grok 做法(22-permissions 文件寫得非常完整,直接當 spec 用):**
  - 鏈式命令以 `&&`/`||`/`;`/`|`/newline 切段;**deny/ask 檢查每一段 + 整串;allow 只 match 整串**(不對稱設計:`Bash(git *)` 會放行 `git status && rm -rf /` —— 文件明說要配 deny 規則補)。**建議我們做得更嚴:allow 也要求每段都命中才免問**,比 grok 安全。
  - 段級檢查前先剝 env 前綴(`RUST_LOG=x cmd`)與固定 wrapper(`timeout`/`nice`/`env`/`stdbuf`…);`sudo`/`xargs`/`nohup` 不剝。`bash -c` 內嵌 script 也要掃 deny。
  - 無法安全切段的結構(subshell、`$(...)`、backtick、background `&`、control flow)整串視為單一單位強制詢問。
  - **dangerous list**(`rm`、`chmod`、`kill*`、`git push` 等):即使命中 remembered prefix 或 read-only 清單也照樣詢問。
  - read-only 命令白名單採 word-boundary 比對(`ls` 不會 match `lsof`)。
- **本專案現況:** `opencode/agentRegistry.ts` 有 bash pattern allow/ask/deny,但是整串 pattern 比對;`toolGuard.decideApprovalNeed` 靠 `sideEffect` hint。鏈式命令、wrapper 剝除、dangerous list 均無 —— `安全指令 && 危險指令` 可能被 allow pattern 整串放行。
- **建議:** 新增純模組 `agent/tools/shellCommandParser.ts`(切段、env/wrapper 剝除、不可切段偵測),`toolGuard.ts` 的 bash 判定改為:每段過 deny → 每段過 dangerous list(強制 ask,allow-pattern 不可越過,語意同現有 `forceAsk`)→ 每段過 allow 才免問;其餘 ask。
- **觸及:** 新檔 `tools/shellCommandParser.ts`、`toolGuard.ts`、`opencode/agentRegistry.ts`;smoke:切段/剝 wrapper/危險清單案例表(這類表格測試最適合現有 smoke 形式)。

### G5(P1)Rewind:檔案快照 + 對話回捲

- **grok 做法:** 每個 user prompt 記一個 rewind point(被改檔案的快照,`rewind_points.jsonl`);`/rewind` 列點 → 還原檔案 → 截斷對話到該點。`xai-hunk-tracker` 用 actor 模式追蹤 hunk 並標注 **Agent vs External** 來源,避免把使用者手改的內容一起回捲。
- **本專案現況:** 完全沒有(grep `rewind|fileSnapshot|restoreFile` 為零)。agent 寫壞檔案只能靠使用者自己 git。對「桌面 app、非工程師使用者」這是安全網等級的缺口。
- **建議:** Electron main 加 `rewindBridge`:`fs:write` 類工具執行前,把目標檔案原內容存到 app userData 下的 per-thread snapshot 目錄(JSONL:runId、stepId、path、hash、before 內容);Thread UI 提供「回捲到此訊息」:還原檔案 + 截斷 thread 訊息 + 清 `lastCapabilityIds` 等 run 延續狀態。第一版不做 hunk 歸因,只在還原前比 hash,若檔案已被外部改動則警示不覆蓋(這就是 hunk-tracker 想解的問題的 80% 保護)。
- **觸及:** `electron/`(新 bridge + preload `window.subagents.rewind*`)、`tools/executor.ts`(寫檔前掛 snapshot)、`store/threadStore.ts`、thread UI;瀏覽器 fallback:feature-detect 後隱藏功能。

### G6(P1)Memory 深化:計分、flush/dream、注入時機

- **grok 做法:** (1) hybrid 計分 vector 0.7 + BM25 0.3、`min_score 0.35`;(2) **temporal decay**:session 記憶 half-life 7 天,global/workspace 豁免;(3) **staleness note**:舊 session 記憶在結果附註「先驗證再信」;(4) `/flush` LLM 摘要入庫、`/dream` 定期整併去重(gate:距上次 ≥4h 且 ≥3 sessions);(5) **first-turn injection** + compaction 後補查;(6) 檔案 watcher 外部編輯自動 reindex。
- **本專案現況:** `hermes/memory.ts`(203 行)+ `sessionSearch.ts` token 計分(刻意不用 SQLite,保可攜性 —— 保留此決策);`learning.ts` 已會從成功 run 起草 memory/skill。缺 decay、staleness、整併、與 compaction 的協作。
- **建議:** 不引入 SQLite/vector(Electron + 瀏覽器雙棲成本高,token 計分夠用),只補四件事:(a) `sessionSearch.ts` 計分加 temporal decay(half-life 可設定)與 source weight;(b) 檢索結果帶 staleness 標註進 prompt;(c) `curator.ts` 加 **dream 整併**:以 grok 的 gate 條件(小時數 + 次數)觸發 LLM 把零散 memory 合併去重(走既有 `textSimilarity.ts` 做 dedup 門檻);(d) G2b 的 pre-compaction flush 即 `/flush` 等價物,共用同一路徑。
- **觸及:** `hermes/memory.ts`、`sessionSearch.ts`、`curator.ts`、`textSimilarity.ts`、`promptBuilder.ts`;settings 三處規則照 CLAUDE.md。

### G7(P1)Hooks 事件面擴充 + 專案級 hooks 信任閘

- **grok 做法:** 14 種事件(含 `PreCompact`/`PostCompact`、`SubagentStart`/`SubagentStop`、`PermissionDenied`、`UserPromptSubmit`、`PostToolUseFailure`、`Notification`);hook 來源含專案目錄(`.grok/hooks/*.json`),**專案 hooks 需 folder-trust 才執行**(防 repo 供應鏈攻擊);支援 HTTP hook;fail-open 但顯式 deny 一定擋。
- **本專案現況:** `agent/hooks.ts` 只有 beforeRun/beforeTool/afterTool/afterRun 四點,來源只有 settings + plugin manifest。哲學上本專案 hooks「只能限制/觀察」比 grok 嚴格,**保留**。
- **建議:** (a) 加事件:`beforeCompaction`/`afterCompaction`(接 G2)、`delegateStart`/`delegateEnd`(接 `hermes/delegate.ts`)、`permissionDenied`(接 `toolGuard`)、`onUserTurn`(接 coordinator);全部 passive(log/notify/append-context),不開放新的 deny 面。(b) 專案級 hook 檔(如 `<project>/.subagents/hooks.json`)沿用 `projectContext.ts` 的探索路徑,但必須加 **per-project trust 確認**(參照 grok folder-trust:未信任前靜默跳過),與現有 hook sanitize 疊加。(c) HTTP hook type 可後補,注意 secrets 不外洩(走 vault 的 `{{secret:key}}`)。
- **觸及:** `agent/hooks.ts`、`taskRunCoordinator.ts`、`toolGuard.ts`、`opencode/compaction.ts`、`hermes/delegate.ts`、`projectContext.ts`、Settings UI(trust 管理)。

### G8(P1)Plan mode:規劃/實作分離

- **grok 做法:** 四態機(Inactive/Pending/Active/ExitPending,persist 過 restart);Active 時**只有 plan 檔可寫**,其他檔案的 edit 工具直接被拒(所有 permission mode 下都成立,包括 always-approve);`exit_plan_mode` 開審批面板,支援逐行 comment / 修改要求 / 核准;compaction 後保留 plan mode 提示。agent 也可自主 `enter_plan_mode`(需使用者核准)。
- **本專案現況:** 有 DoD/replan/continueGoal,但沒有「先給人看計畫再動手」的模式;`approvalMode` 是逐工具粒度,不是階段粒度。
- **建議:** 在 run 層加 `planMode` 狀態:Active 時 `toolGuard` 對寫檔/side-effect 工具一律 deny(白名單:plan 文件路徑,建議即 `.scratch/<feature-slug>/` 下的 issue/spec 檔,與現有 issue-tracker 慣例直接銜接);新增 `enter_plan_mode`/`exit_plan_mode` framework 工具(進 `capabilities/builtins.ts` 保留字);exit 時彈 HITL 審批(重用 `permissionAskStore` 面板,加計畫預覽)。unattended run 禁用 plan mode(無人可審)。
- **觸及:** `agent/types.ts`、`toolGuard.ts`、`capabilities/builtins.ts`、`tools/registry.ts` 四件套、`engine.ts`、composer UI。

### G9(P2)Delegate 升級:capability mode / persona / resume / worktree

- **grok 做法:** `spawn_subagent` 帶 `capability_mode`(read-only/read-write/execute/all 粗篩)、persona overlay(含 **inputs/outputs 契約**,宣告子代理吃什麼檔、產什麼檔,可串鏈)、`resume_from`(接續已完成子代理的 transcript)、`isolation: worktree`(git worktree 隔離 + apply 合回)、深度上限 1。
- **本專案現況:** `delegate.ts` 有 leaf isolation(blockedTools)+ DelegationBudget(深度/並行),已相當;缺粗粒度模式、persona、resume、worktree。
- **建議(按性價比排):** (a) `delegate_task` 加 `capability_mode`,映射成預組 blockedTools 集合 —— 半天工。(b) persona = 具名的 instruction overlay + 模型覆寫,存 settings(結構同 `roleModels` 旁),`inherit_capabilities` 之外再加 `persona` 參數;inputs/outputs 契約先只做描述性欄位(進 prompt),不做強制驗證。(c) `resume_from`:child thread 已存在於 threadStore,補一個「以既有 child thread 上下文再派生」的路徑。(d) worktree:`electron/projectBridge.ts` 已能列 worktree,補 create/apply/remove 三個 IPC;僅 Electron 有效,瀏覽器降級為不支援。
- **觸及:** `hermes/delegate.ts`、`tools/schemas.ts`、`electron/projectBridge.ts`、settings 三件套。

### G10(P2)背景監控原語:monitor + wait

- **grok 做法:** `monitor` 工具:跑一條長命令,stdout/stderr 每行變成一則對話通知;音量控制(事件太多自動停掉,要求收窄 filter);`persistent: true` 跟 session 同壽命。`wait_commands_or_subagents(task_ids, wait_any|wait_all, timeout)` 一次等多個任務;`kill_*` 統一終止。
- **本專案現況:** `backgroundJobs.ts` fire-and-forget + scheduler 輪詢;沒有「事件流駆動 agent turn」的原語 —— 但本專案已有 eventMatcher/Proactive 管線,monitor 事件可以直接餵進去,比 grok 還順。
- **建議:** `monitor` 工具走 Electron pty bridge(已有),每行輸出經節流(行數/秒上限,超過自動停止並回報)後作為 event 證據進 `eventMatcher` → 觸發 Proactive loop,完全符合「Proactive 必須有 verified 證據」的紀律。`wait_any/wait_all` 加進 `backgroundJobs.ts`。
- **觸及:** `tools/`(registry/schemas/executor/builtins 四件套)、`hermes/backgroundJobs.ts`、`eventMatcher.ts`、`electron/`(pty 已有)。

### G11(P2)觀測性:用量與決策指標

- **grok 做法:** OTel 輸出 token 用量(by model/type)、session 數、**tool-permission denial ratio** 等;明確 privacy model(不含 prompt 內容)。
- **建議:** 第一版不接 OTLP,只在本地累積 JSONL 指標(每 run:tokens by role-model、工具核准/拒絕數、compaction 次數、breaker 事件),Settings 加匯出;denial ratio 是調 `approvalMode`/allowlist 的關鍵回饋。之後要接 OTel 再說。
- **觸及:** `taskRunCoordinator.ts`(單一 finalization 點正好統一記帳)、新 `agent/metrics.ts`、Settings UI。

---

## 4. 明確不採納 / 暫緩項目

| 項目 | 理由 |
|---|---|
| OS 核心層 sandbox(Landlock/Seatbelt/bwrap) | Electron 跨平台(含純瀏覽器模式)無法統一;本專案以 toolGuard + supervisor + CodeMode Worker 隔離為主。可作長期選項:shell 工具在 macOS 包 `sandbox-exec`、Linux 包 `bwrap` 的 opt-in wrapper。 |
| ACP(Agent Client Protocol)server mode | 產品定位不同(桌面 app vs editor-embedded agent);若未來要讓外部 IDE 驅動本引擎再評估。 |
| SQLite FTS5 + vec0 記憶索引 | 現有 token-scoring 可攜性優先;G6 只補計分語意不換儲存。 |
| `xai-sqlite-journal`(NFS WAL 問題) | 平台特定,無對應場景。 |
| TUI 專屬(scrollback、ratatui、dashboard 鍵盤流) | 本專案是 GUI;dashboard 概念已有頁面承載。 |
| Cursor/Claude hooks 相容層 | 本專案 hooks 是自有 schema + plugin manifest,無外部存量要相容。 |
| grok `/loop` 式「對話文字建排程」直接執行 | 違反本專案 trigger 紀律;維持 automation suggestion 流程。 |

---

## 5. 分階段執行計畫

每個 Phase 結束條件一律:`npm run build` 過、`npm run smoke` 過(新純邏輯需附 smoke 案例)、`npx oxlint src` 乾淨;涉及 settings 新欄位者,依 CLAUDE.md 完成 types/defaults/SettingsPage 三處。

### Phase 0 — 穩定性地基(G1 + G3)
1. `agent/tokenEstimate.ts`:bytes/4 估算 + contextWindow 佔比;`modelProfile.ts` 加 `contextWindow` fact。
2. `llm.ts` 加 retry/backoff + per-provider circuit breaker;open 時觸發既有 degrade 路徑;事件寫 run log。
3. preflight overflow check 接進 `toolLoop.ts`(超限先 compact)。
4. smoke:breaker 狀態機表、估算/gate 數學。

### Phase 1 — 上下文治理(G2)
1. `pruneToolResults` 三層截斷(豁免近 N turns、soft-trim 頭尾、hard-clear placeholder),掛在 compaction 之前,守住 tool-call chain 對齊。
2. pre-compaction memory flush(重用 learning 摘要路徑)+ compaction 後 memory 補注入 ContextPacket。
3. compaction checkpoint 存檔(Electron IPC;瀏覽器降級為僅保留最近一份於 localStorage)。
4. thread UI 顯示 context meter(消費 Phase 0 的估算)。

### Phase 2 — 安全強化(G4 + G7 部分)
1. `shellCommandParser.ts`:切段、env/wrapper 剝除、不可切段偵測;smoke 案例表。
2. `toolGuard.ts`:段級 deny/ask、dangerous list 走 `forceAsk` 語意、allow 需全段命中。
3. hooks 加 `permissionDenied` 事件(接 G11 的 denial 記帳)。

### Phase 3 — 安全網與記憶(G5 + G6)
1. Electron rewind bridge + 寫檔前 snapshot + thread「回捲到此訊息」;hash 不符警示不覆蓋。
2. memory 計分加 temporal decay / source weight / staleness 標註;curator 加 dream 整併(gate:時數 + 次數)。

### Phase 4 — 產品力(G8 + G7 其餘)
1. Plan mode 狀態機 + `enter/exit_plan_mode` framework 工具 + 審批面板;plan 檔落 `.scratch/<slug>/`,unattended 禁用。
2. hooks 事件補齊(compaction/delegate/onUserTurn)+ 專案級 hooks 檔與 per-project trust 閘。

### Phase 5 — 委派與監控(G9 + G10 + G11)
1. delegate `capability_mode` → persona → `resume_from` → worktree IPC(依序,各自獨立可交付)。
2. `monitor` 工具 + 節流 + 事件餵 `eventMatcher`;`wait_any/all` 進 backgroundJobs。
3. `agent/metrics.ts` 本地指標 + Settings 匯出。

---

## 6. 風險與備註

1. **範圍膨脹**:G5(rewind)與 G8(plan mode)各自是完整功能,不要與其他缺口混在同一 PR;每項獨立可回退。
2. **瀏覽器模式**:rewind、worktree、monitor 皆依賴 Electron bridge,一律 `window.subagents?.x` feature-detect,缺席時 UI 隱藏而非報錯(CLAUDE.md 既有紀律)。
3. **Grok 的 allow 整串比對是已知弱點**(文件自己承認 `Bash(git *)` 放行 `git status && rm -rf /`);G4 我們採更嚴格的全段命中,不要照抄。
4. **hooks fail-open vs 本專案 deny 能力**:grok hooks fail-open 是它的取捨;本專案 hook `deny`/`require-approval` 語意保持現狀,新事件只做 passive。
5. **授權**:grok-build 為 Apache-2.0,但本計畫僅移植設計與參數(如 pruning 閾值、decay half-life、breaker 條件),不搬運程式碼;若未來直接移植片段,需按 Apache §4(b) 加變更聲明(grok-build 對 codex/opencode 的 THIRD_PARTY_NOTICES 做法可為範本)。
