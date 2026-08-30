# Development State

截至 2026-08-30。

## 本日收口：Adaptive Agent Run Status Surface

`.scratch/adaptive-agent-run-status-surface` 1/1 ticket resolved。Live run rail 現在固定以 bounded「執行狀態」回答目前 phase，第二區只依 frozen capability 與 Host/runtime evidence 顯示「任務進度」、「最近活動」、「需要你處理」或「執行摘要」；沒有實質內容時隱藏。Objective、assistant/instruction bodies、reference history、constraints、absolute paths、raw output、Host revision 與 runner guarantee 不再成為預設狀態文案，診斷資料留在預設收合且可鍵盤操作的「執行資訊」。External CLI process success 明確不冒充 Checker completion。

真 `InlineRunPanel` rendered matrix 覆蓋 builtin、External CLI、approval/auth/input、terminal、simple-hide、hostile context、reload 與 accessibility；`npm run smoke:run-status-surface`、91 項 capability guards、`npm run build`、`npx oxlint src`（exit 0，三個既有 warning）及完整 `npm run smoke` 全綠。畫面證據與一 hop 對帳見 `.scratch/adaptive-agent-run-status-surface/qualification.md`。

## 本日收口：Run Review Workspace

`.scratch/run-review-workspace` 15/15 tickets resolved。Host-owned immutable Run Review Snapshot 已涵蓋 admission binding、settlement capture、restart/reload、export/import/retention、comments/follow-up、verification與 preview-first Git delivery；歷史 snapshot 不 fallback 至 live working tree，shared checkout 以 `shared`／`partial` 誠實降級，stage/revert/commit/push/PR 全受 revision CAS、approval 與 crash recovery 保護。

Release qualification 已通過 `npm run build`、`npx oxlint src`（exit 0，三個既有 warning）、`npm run smoke:review-workspace-binding`、真 Electron builtin + Codex CLI 的 `npm run qualify:review-real-runners`，以及單一非重疊程序的完整 `npm run smoke`。真 renderer 另驗證 desktop、320px narrow、keyboard/focus/overflow、205-file large diff，以及 partial/binary/missing/error states。一 hop 證據見 `.scratch/run-review-workspace/qualification.md` 與 ADR-0054。

## 本日進展：Codex-aligned personalization 本機收口

Codex-aligned personalization 的 Host-owned Instruction Repository、Pi resource discovery、immutable Task admission snapshot、Turn Record replay、atomic project-file CAS、Personalization UI 與 outbound authority gates 已完成。本輪 `npm run build`、`smoke:instructions`、`smoke:instruction-release`、完整 `npm run smoke` 與 real Pi Host strict-provenance E2E 全綠；anti-slop UI 複查另以 desktop、conflict 與 280px narrow 真 renderer 畫面驗證，修正 shared Settings button 的 40px hit target 與 `focus-visible`。

一 hop 證據見 `.scratch/codex-aligned-personalization-instructions/qualification.md`。effort 仍維持 needs-info，不宣稱 resolved：外部 CLI ticket #11 尚缺 native-discovery 真機證據，Codex 為 `native_discovery_unproven`，Claude 為 `auth_unavailable`，兩者皆是 explicit blocked／unqualified。

## 本日進展：SubDesign deep modules 與 tracker 修正

SubDesign architecture deepening #01–#04 已收口：既有 `workspace.ts` 公開 controller 經驗證為單一 renderer workflow seam；Host provider 改為 registry + normalized adapter result；`streamingProjection.ts` 由 Host snapshot + typed events 同時推導 preview/activity、terminal 與 static fallback；`applyOpenDesignPack` 將 Electron copy、canonical metadata、local projection 與 audit 串成 fail-closed transition。#05 已移出 capability/resources/extensions domains，並以 canonical cursor 產生 explicit commit outcome、刪除 method-prefix persistence heuristic；sessions/runs/tools 尚未通過 deletion test，故維持 open。

`smoke-pi-git-preferences.mts` 現在明確清除 `SUBAGENTS_PI_NATIVE_AGENT_DIR`，不再讀取使用者 `~/.pi/agent`。harness-gap closure #02–#05、#08、#12–#14、#16–#17 依既有 gate evidence 翻 resolved；SubDesign pinned audit #06 補齊 canonical project-relative 記錄與 UI 回查後翻 resolved。vendored Pi TODO/FIXME 保留給 upstream sync，本輪未改 vendor。

## 本日進展：durable memory SQLite migration

`.scratch/durable-memory-sqlite-migration` 16/16 tickets resolved。Host-owned async `DurableMemoryStore` 是唯一 mutation authority；production 使用 WAL SQLite，renderer 僅保留 paged projection。scope/policy/idempotency、JSON 原子遷移、builtin scoped recall 與 Turn Record provenance、Memory Pack、finalization-owned learning、Learning/Settings refetch、scoped hard delete、Dream transaction、canonical export、preview-first import、storage degradation/downgrade 及 durability/concurrency/privacy matrix 全部接入同一 lifecycle。

Ticket 15 完成 contract：Pi Host Protocol v5 移除 whole-bundle `memory/*` 舊方法與 `result.memories`，schema 4 snapshot 不再含 `memories`，Supervisor/Main/Preload 舊橋接與 mutable `PiMemoryExtension` 已刪；v2-v4 snapshot consumer fail-closed。Ticket 16 新增 `smoke-durable-memory-workflow-qualification.mts`，一 hop 固定 16 個 owning smokes 並 source-audit single authority。`npm run build`、oxlint、Pi parity qualification 與乾淨 HEAD 的完整 `npm run smoke` 全綠。復原與證據界線見 `.scratch/durable-memory-sqlite-migration/cutover-recovery.md`。

## 本日收口：tracker 對帳

`.scratch/tracker-truth-reconciliation`（七票全數 resolved）完成一次全面對帳：以 smoke gate 為唯一證據核對五個訊號來源；`resolved` 證據定義入冊 `docs/agents/triage-labels.md`；新增恰好一支 drift guard `app/scripts/smoke-tracker-index-links.mts`（INDEX 相對路徑必須存在，檔案與目錄皆驗、無豁免、掛 `npm run smoke` 主鏈——首跑即抓出全部四條死連結）；`.scratch/INDEX.md` 重寫（Active frontier 只留真開工作、resolved 表附一 hop 證據、新增 Known residuals 與待維護者裁決 queue、死連結改下場註記）；本檔同步重寫。

## 本日收口：workspace text search

`.scratch/workspace-text-search` 4/4 tickets resolved：`workspace_grep`／`workspace_glob` 以 Pi Host Extension Pack 接上生產工具面，受「設定→一般→工作區文字檢索」單一開關治理（預設 OFF、無有效 workspace 時 fail-closed），並固定每一 run 的 availability snapshot；catalog、capability、直接 execute 與 `run_code` 巢狀重入皆受同一 Host gate。證據：`npm run smoke:workspace-text-search` 19/19、`npm run build`、完整 `npm run smoke` 全綠；Browser 實點確認開關持久化與 reload 行為。harness-gap-closure #06 的過時 renderer 處方以 superseded 收口。

## 自 2026-08-15 以來已落地（git 證據）

- **remove-legacy-engine（PR #8–#13 合併）**：`agent/engine.ts` 與 `agent/loop/` 自程式碼刪除，Pi Core Host 為唯一 tool-loop owner；ADR-0045 初始化門檻已過。loop-runner-deepening effort 隨之收口（目錄已移除）。
- **pi-host-tool-and-skill-parity**：19/19 票驗收框全滿翻 resolved——十個 extension pack 落地、`pi.registerTool()`／`additionalSkillPaths` 接縫通、renderer 等價工具與 `piTurnContext` 技能注入刪除；唯一 `[~]`（hermes/skills.ts 唯讀回滾版本）入 INDEX known residuals。
- **pi-agent-runtime-contract**：22 張中 20 張完成；#18 已採 Host enforcement 收口，殘餘 #14（Linux bwrap 真機 qualification，需 Linux CI 首綠）與 #22 rollup。
- **active-run-reattachment**：12/12 resolved；Pi Host attachment journal、renderer bootstrap、finalization CAS、restart e2e 與「terminal finalization 不阻塞啟動」owning ticket 均已歸位。
- **turn-record-fidelity**（12/12）、**cli-subscription-pi-loop**（ADR-0052，含真機 E2E）、**subscription-surface-hardening**（5/5）皆 resolved。
- **trajectory-review-closure** 3/3 resolved：真 renderer 同頁比較 windowed／full-map；載入十頁後為 165 nodes／27 rows 對 1,653／275，實測列距 28.5 px，維持 rowHeight 28、overscan 8。
- release gate 於 `b8e1888` 轉綠（ADR-0052 兩支真機憑證 qualifier 列入 `KNOWN_UNGATED_TESTS`——列出非豁免）。

## 工作區現況（重要）

工作樹包含本次 code-review 修復：複雜度回歸閘門、既有高複雜函式拆分、active-run reattachment owner 抽離、trajectory 真機量測證據與 tracker 對帳。最終 lint／build／smoke 結果以本次收口記錄為準。

## 已知阻塞 / 待裁決（詳見 .scratch/INDEX.md）

1. paid-beta #14 release qualification——需 clean-machine signed 安裝等真機證據（目錄已移除，殘餘遷記 Remaining blocked）。
2. runtime-contract #14——Linux CI 首綠後補勾三框。
3. harness-gap-closure #09——待維護者裁決。
4. codex-aligned personalization #11——需可用 Codex／Claude 真機環境補 native filesystem discovery 證據；目前 Codex `native_discovery_unproven`、Claude `auth_unavailable`。

## 延續未解（自 08-15 記載）

- vendored Pi build 的 offline-to-network fallback 與真正 electron-builder 安裝包尚未實測。
- 既有 build warnings（Vite deprecation、renderer `node:*` externalization、large chunk）延後處理。

## 下一步

依 `.scratch/INDEX.md` Active frontier 排工：codex-aligned personalization 只剩 #11 外部 native-discovery qualification；可直接實作項目優先完成 subdesign-architecture-deepening #05 的 protocol domain extraction；external-cli-durable-harness #07 的未安裝 provider 真機證據仍需外部環境。
