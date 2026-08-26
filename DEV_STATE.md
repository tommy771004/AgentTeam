# Development State

截至 2026-08-26（tracker-truth-reconciliation 對帳日）。`main` 基準 commit `b8e1888`。

## 本日收口：tracker 對帳

`.scratch/tracker-truth-reconciliation`（七票全數 resolved）完成一次全面對帳：以 smoke gate 為唯一證據核對五個訊號來源；`resolved` 證據定義入冊 `docs/agents/triage-labels.md`；新增恰好一支 drift guard `app/scripts/smoke-tracker-index-links.mts`（INDEX 相對路徑必須存在，檔案與目錄皆驗、無豁免、掛 `npm run smoke` 主鏈——首跑即抓出全部四條死連結）；`.scratch/INDEX.md` 重寫（Active frontier 只留真開工作、resolved 表附一 hop 證據、新增 Known residuals 與待維護者裁決 queue、死連結改下場註記）；本檔同步重寫。

## 本日收口：workspace text search

`.scratch/workspace-text-search` 4/4 tickets resolved：`workspace_grep`／`workspace_glob` 以 Pi Host Extension Pack 接上生產工具面，受「設定→一般→工作區文字檢索」單一開關治理（預設 OFF、無有效 workspace 時 fail-closed），並固定每一 run 的 availability snapshot；catalog、capability、直接 execute 與 `run_code` 巢狀重入皆受同一 Host gate。證據：`npm run smoke:workspace-text-search` 19/19、`npm run build`、完整 `npm run smoke` 全綠；Browser 實點確認開關持久化與 reload 行為。harness-gap-closure #06 的過時 renderer 處方以 superseded 收口。

## 自 2026-08-15 以來已落地（git 證據）

- **remove-legacy-engine（PR #8–#13 合併）**：`agent/engine.ts` 與 `agent/loop/` 自程式碼刪除，Pi Core Host 為唯一 tool-loop owner；ADR-0045 初始化門檻已過。loop-runner-deepening effort 隨之收口（目錄已移除）。
- **pi-host-tool-and-skill-parity**：19/19 票驗收框全滿翻 resolved——十個 extension pack 落地、`pi.registerTool()`／`additionalSkillPaths` 接縫通、renderer 等價工具與 `piTurnContext` 技能注入刪除；唯一 `[~]`（hermes/skills.ts 唯讀回滾版本）入 INDEX known residuals。
- **pi-agent-runtime-contract**：22 張中 19 張完成；殘餘 #14（Linux bwrap 真機 qualification，需 Linux CI 首綠）、#18（git `--force` 移除裁決）、#22 rollup。
- **active-run-reattachment**：01 決策resolved＋protocol v3 attachment persistence、pending approval attachment、finalization claim lease、renderer 重附著、`reattachReconcile.ts` 純模組＋`smoke-reattach-reconcile.mts` 上主鏈；02–11 票框待負責人對證據補勾。
- **turn-record-fidelity**（12/12）與 **cli-subscription-pi-loop**（ADR-0052，含真機 E2E）resolved；**trajectory-review-closure** 01/02 resolved（視窗虛擬化＋InlineRunPanel 掛載），僅剩 #03 人工量測。
- release gate 於 `b8e1888` 轉綠（ADR-0052 兩支真機憑證 qualifier 列入 `KNOWN_UNGATED_TESTS`——列出非豁免）。

## 工作區現況（重要）

工作樹有一批**未提交**的 subscription-surface-hardening WIP（約 20+ 檔：Settings 訂閱面誠實性、離線 catalog 後備、`useSubscriptionCatalog` 共享 hook 等），另一 session 於本日下午活躍編輯中。WIP 中途狀態會使工作樹上的完整 `npm run smoke` 在 `smoke-subscription-labeling.mts` 中段紅燈——屬競態而非已提交破壞；該 effort 收口的 gate run 會一併確認全鏈綠。對帳相關變更（`.scratch/**`、`docs/agents/**`、`DEV_STATE.md`、guard 腳本與 package.json 接線）與該 WIP 不相交。

## 已知阻塞 / 待裁決（詳見 .scratch/INDEX.md）

1. paid-beta #14 release qualification——需 clean-machine signed 安裝等真機證據（目錄已移除，殘餘遷記 Remaining blocked）。
2. runtime-contract #14——Linux CI 首綠後補勾三框。
3. trajectory-review-closure #03——人工量測 pass（fixture loader 與程序文件已驗就緒，證據模板已備於 `evidence/measurement-pass.md`）。
4. harness-gap-closure #09、runtime-contract #18——待維護者裁決。

## 延續未解（自 08-15 記載）

- vendored Pi build 的 offline-to-network fallback 與真正 electron-builder 安裝包尚未實測。
- 既有 build warnings（Vite deprecation、renderer `node:*` externalization、large chunk）延後處理。

## 下一步

等 subscription-surface-hardening 收口（其 gate run 驗證全鏈綠）→ 依 `.scratch/INDEX.md` Active frontier 排工：context-usage-panel（8 票未動）與 external-cli-durable-harness（7 票未動）兩條線可並行開工。
