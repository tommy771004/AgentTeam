# Development State

截至 2026-08-27。

## 本日進展：durable memory SQLite migration

`.scratch/durable-memory-sqlite-migration` #01–04 已 resolved：Host-owned async `DurableMemoryStore` 契約與 in-memory／SQLite parity、scope/policy/idempotency、atomic legacy migration 全部接入 production。使用者核准 Host state 佈局後，舊 pathname 成為目錄 downgrade barrier；sessions/settings 等仍在 `snapshot.json`，長期記憶則只認 SQLite，原始 JSON 是 `0600` recovery evidence，不是 live authority。

#04 以真 Host 證明 v1/v2、invalid/quarantine、同 key 跨 scope、special entries、四個 crash boundary、commit 後 retry、clear 後不回放 backup、DB 遺失拒絕與 OS rename downgrade barrier。legacy protocol／turn／Memory Pack 的最小 adapter 均不再更新 JSON；pack policy 由 frozen run binding 提供。相關 oxlint、Node typecheck、complexity gate、`npm run build`、Pi parity/Host gates 與完整 `npm run smoke` 全綠。05/07/08/13 現為可並行 frontier；06 仍依賴 05，細項不可由 #04 的最小 adapter 提前翻牌。復原與證據界線見 `.scratch/durable-memory-sqlite-migration/cutover-recovery.md`。

## 本日收口：tracker 對帳

`.scratch/tracker-truth-reconciliation`（七票全數 resolved）完成一次全面對帳：以 smoke gate 為唯一證據核對五個訊號來源；`resolved` 證據定義入冊 `docs/agents/triage-labels.md`；新增恰好一支 drift guard `app/scripts/smoke-tracker-index-links.mts`（INDEX 相對路徑必須存在，檔案與目錄皆驗、無豁免、掛 `npm run smoke` 主鏈——首跑即抓出全部四條死連結）；`.scratch/INDEX.md` 重寫（Active frontier 只留真開工作、resolved 表附一 hop 證據、新增 Known residuals 與待維護者裁決 queue、死連結改下場註記）；本檔同步重寫。

## 本日收口：workspace text search

`.scratch/workspace-text-search` 4/4 tickets resolved：`workspace_grep`／`workspace_glob` 以 Pi Host Extension Pack 接上生產工具面，受「設定→一般→工作區文字檢索」單一開關治理（預設 OFF、無有效 workspace 時 fail-closed），並固定每一 run 的 availability snapshot；catalog、capability、直接 execute 與 `run_code` 巢狀重入皆受同一 Host gate。證據：`npm run smoke:workspace-text-search` 19/19、`npm run build`、完整 `npm run smoke` 全綠；Browser 實點確認開關持久化與 reload 行為。harness-gap-closure #06 的過時 renderer 處方以 superseded 收口。

## 自 2026-08-15 以來已落地（git 證據）

- **remove-legacy-engine（PR #8–#13 合併）**：`agent/engine.ts` 與 `agent/loop/` 自程式碼刪除，Pi Core Host 為唯一 tool-loop owner；ADR-0045 初始化門檻已過。loop-runner-deepening effort 隨之收口（目錄已移除）。
- **pi-host-tool-and-skill-parity**：19/19 票驗收框全滿翻 resolved——十個 extension pack 落地、`pi.registerTool()`／`additionalSkillPaths` 接縫通、renderer 等價工具與 `piTurnContext` 技能注入刪除；唯一 `[~]`（hermes/skills.ts 唯讀回滾版本）入 INDEX known residuals。
- **pi-agent-runtime-contract**：22 張中 19 張完成；殘餘 #14（Linux bwrap 真機 qualification，需 Linux CI 首綠）、#18（git `--force` 移除裁決）、#22 rollup。
- **active-run-reattachment**：12/12 resolved；Pi Host attachment journal、renderer bootstrap、finalization CAS、restart e2e 與「terminal finalization 不阻塞啟動」owning ticket 均已歸位。
- **turn-record-fidelity**（12/12）、**cli-subscription-pi-loop**（ADR-0052，含真機 E2E）、**subscription-surface-hardening**（5/5）皆 resolved。
- **trajectory-review-closure** 3/3 resolved：真 renderer 同頁比較 windowed／full-map；載入十頁後為 165 nodes／27 rows 對 1,653／275，實測列距 28.5 px，維持 rowHeight 28、overscan 8。
- release gate 於 `b8e1888` 轉綠（ADR-0052 兩支真機憑證 qualifier 列入 `KNOWN_UNGATED_TESTS`——列出非豁免）。

## 工作區現況（重要）

工作樹包含本次 code-review 修復：複雜度回歸閘門、既有高複雜函式拆分、active-run reattachment owner 抽離、trajectory 真機量測證據與 tracker 對帳。最終 lint／build／smoke 結果以本次收口記錄為準。

## 已知阻塞 / 待裁決（詳見 .scratch/INDEX.md）

1. paid-beta #14 release qualification——需 clean-machine signed 安裝等真機證據（目錄已移除，殘餘遷記 Remaining blocked）。
2. runtime-contract #14——Linux CI 首綠後補勾三框。
3. harness-gap-closure #09、runtime-contract #18——待維護者裁決。

## 延續未解（自 08-15 記載）

- vendored Pi build 的 offline-to-network fallback 與真正 electron-builder 安裝包尚未實測。
- 既有 build warnings（Vite deprecation、renderer `node:*` externalization、large chunk）延後處理。

## 下一步

依 `.scratch/INDEX.md` Active frontier 排工：durable-memory-sqlite-migration 的 #05／#07／#08／#13 可並行，#06 接 #05；context-usage-panel 與 external-cli-durable-harness 仍可並行開工。
