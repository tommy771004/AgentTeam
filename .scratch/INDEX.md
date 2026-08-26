# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.  
**對帳紀律（2026-08-26 起）**：`resolved` 的證據定義與 DEV_STATE 更新紀律見 `docs/agents/triage-labels.md`。本檔內所有相對路徑引用由 `app/scripts/smoke-tracker-index-links.mts` 守衛（掛 `npm run smoke`）：死路徑會讓 build 紅。

## Active frontier (implement next)

| Effort | Spec | Frontier | Notes |
|--------|------|----------|-------|
| **subscription-surface-hardening** | [spec.md](subscription-surface-hardening/spec.md) | **resolved** | 4/5 tickets done＋05 收口（finalization owning ticket 落於 active-run-reattachment #12）。2026-08-26 三輪 two-axis review 的修復 effort：Settings 訂閱面誠實性（訊息順序／正字／衝突後可刷新＋手動重新整理）、離線快取 catalog 後備＋stale 如實標示、catalog 模組四項去重、usage 輪詢防復活契約。證據：smoke-subscription-catalog／labeling／context-usage-projection／pi-host-protocol 全綠＋全套 `npm run smoke` 通過。 |
| **trajectory-review-closure** | [spec.md](trajectory-review-closure/spec.md) | [03 量測 pass](trajectory-review-closure/issues/03-measurement-pass.md) | 01、02 resolved（純函式窗口＋決定論 smoke、InlineRunPanel「執行軌跡」section＋惰性 sessionId 解析＋防復發 drift guard，皆已接 gate）。僅剩 [03 量測 pass](trajectory-review-closure/issues/03-measurement-pass.md) `需人工處理`——fixture 與程序文件已備，缺真機 before/after DOM 節點數證據與 overscan 定案；無證據不得勾（fail-closed）。 |
| **context-usage-panel** | [spec.md](context-usage-panel/spec.md) | [01 usage 記錄擴充 + Host 補抓](context-usage-panel/issues/01-usage-record-capture.md) | 8 張 `可交給代理` tickets（勾選框核實 0/38 勾，確實未動）。opencode 式 session 上下文面板：token/cost/快取落在 `step-end` usage（ADR-0039/0049 語意），單一測試接縫為 `projectContextUsage` 純投影。依賴：01 先行 → 02/03 並行 → 04/06/07 並行 → 05←03+04 → 08 收口。 |
| **external-cli-durable-harness** | [spec.md](external-cli-durable-harness/spec.md) | [01 External CLI Run Session seam](external-cli-durable-harness/issues/01-expand-external-cli-run-session-seam.md) | 7 張 `可交給代理` tickets（2026-08-26 核實：66 個驗收框全開，確實未動）；01 先建立 expand seam，之後 02/03/05 可並行，04 依賴 02/03，06 依賴 02，07 為完整 qualification。trf#11 的 seam-1 真 CLI 斷言由本 effort 承接。 |
| **harness-gap-closure** | [spec.md](harness-gap-closure/spec.md) | [01 統一架構敘述](harness-gap-closure/issues/01-unify-architecture-narrative.md) | 17 張票，10 張已完成（#02 #03 #04 #05 #08 #12 #13 #14 #16 #17，驗收框全滿＋gate smoke 綠），7 張未動：#01（敘述統一；注意其問題陳述寫於 remove-legacy-engine 合併前，「兩條路徑並存」已是歷史，動工前先照現實重新框限）、#06 workspace grep/glob、#07 spill 大工具輸出、#10 headless 入口、#11 evaluation harness、#15 outbound run view。09 為範圍決策，見下方待維護者裁決 queue。 |
| **active-run-reattachment** | [spec.md](active-run-reattachment/spec.md) | 02–11（框待負責人對證據補勾） | 01 resolved：以 **Pi Core Host journal** 為 active／terminal attachment 唯一真相，main 只 relay，Pi Host Protocol v2→v3；決策見 [decision.md](active-run-reattachment/decision.md)。**對帳註記（2026-08-26）**：02–11 驗收框仍全開，但 git 顯示大量對應實作已落地——`reattachReconcile.ts` 純模組＋`smoke-reattach-reconcile.mts` 在主 smoke 鏈（commit e002493）、protocol v3 attachment persistence＋pending approval attachment＋finalization claim lease（93acc1b／53674f5／9d56e8d／92c2c78）、renderer 重附著（adb80fd）。票框與證據的歸位是票主判斷，不自動翻牌。範圍仍不含 main／Host process 重啟。 |
| **pi-agent-runtime-contract** | spec（見目錄） | [#14 Linux bwrap 真機](pi-agent-runtime-contract/issues/14-linux-bubblewrap-builtin-shell-tracer.md) · [#18 git preferences 裁決](pi-agent-runtime-contract/issues/18-git-preferences-reach-no-runtime.md) · [#22 rollup](pi-agent-runtime-contract/issues/22-remaining-work-rollup.md) | 對帳後現實：22 張中 19 張驗收框全滿且 gate smoke 綠（`npm run qualify:pi-runtime-contract` 在主鏈）。殘餘三張：#14 需 Linux CI 首綠（macOS seatbelt tracer 已完成）、#18 待維護者裁決 git `--force` 移除語意、#22 rollup 開 2.1（＝#14 三框）與 3.1（`KNOWN_UNGATED_TESTS` 依 ADR-0052 為「列出非豁免」清單，清空目標需重新表述）。 |
| **workspace-text-search** | [spec.md](workspace-text-search/spec.md) | [01 設定開關](workspace-text-search/issues/01-settings-toggle.md) | 4 張 `可交給代理` tickets（2026-08-26 發布，全未動）。把已存在於 renderer seam／workspaceFs 的 grep/glob 接上 Pi Host 生產路徑（Extension Pack 工具，ADR-0027 等價取代），全部改動受 設定→一般 單一開關治理（預設關閉、fail-closed）；唯一新測試接縫為 pack 層級 smoke。線性依賴 01←02←03←04。**承接 harness-gap-closure #06 的剩餘價值**（該票處方寫於凍結前已過時，Comments 已註記，下場歸本 effort 04 對帳）。 |
| **subdesign-p0-harness-gaps** | [spec.md](subdesign-p0-harness-gaps/spec.md) | [01 Gate evidence contract](subdesign-p0-harness-gaps/issues/01-gate-evidence-contract-fail-closed.md) · [05 Pin 模式端到端](subdesign-p0-harness-gaps/issues/05-pin-mode-end-to-end.md) · [07 Register 快照 + restore](subdesign-p0-harness-gaps/issues/07-register-snapshot-restore.md) | 8 張 `可交給代理` 票、三條並行線（A gates：01→02→03，04←01；B pins：05→06；C snapshots：07→08）；由 `docs/research/claude-design-clones-harness-comparison.md` P0 建議展開 |
| **subdesign-architecture-deepening** | [spec.md](subdesign-architecture-deepening/spec.md) | [01 SubDesign workspace module](subdesign-architecture-deepening/issues/01-deepen-subdesign-workspace-module.md) | 5 張 `可交給代理` tickets；01 與 02 可先行，03/04 依賴 01，05 依賴 02/03 |

## Resolved this session chain

| Effort | Status | 一 hop 證據 |
|--------|--------|------------|
| tracker-truth-reconciliation | resolved（2026-08-26 本日收口；[spec.md](tracker-truth-reconciliation/spec.md)） | guard `smoke-tracker-index-links.mts` 掛主鏈並綠；七張對帳票 Comments 附證據；DEV_STATE 同日更新 |
| pi-host-tool-and-skill-parity | resolved（19/19 驗收框全滿） | `smoke-pi-parity-qualification` 在主鏈；十個 extension pack 落地（ef781cf）、renderer 等價工具刪除＋單一 owner（a6d7754、b0f615a）；唯一 `[~]` 見 known residuals #18 |
| turn-record-fidelity | resolved（12/12 tickets done） | `smoke-record-fidelity-qualification` 在主鏈；Host 端 seq/turn/step Turn Record，答案／模型歷史／UI Projection 三者皆由它推導（ADR-0039/0049/0050）；刻意 `[~]` 見 known residuals |
| cli-subscription-pi-loop | resolved（6/6 tickets done） | [qualification.md](cli-subscription-pi-loop/qualification.md)：99 smoke 全綠＋真機 E2E（隔離 dir 匯入真 codex OAuth → gpt-5.4-mini 經 Pi loop 回答）；可重跑 `qualify-subscription-snapshot.mts` / `qualify-subscription-e2e.mts` |
| tool-invocation-pipeline / review-cleanup | resolved | — |
| hermes-aligned-runtime + registry-executor-cleanup | resolved | — |
| outbound-data-gate（01–25 + evidence residual + PolicyAdmin extract） | resolved | — |
| execution-trust-and-safety / hardening | resolved | — |
| task-run-coordinator-deepening / single-owner-cleanup | resolved | — |
| subdesign-project-workspace（含 05 自動化 smoke） | resolved | — |
| paid-beta 05, 10–13（composer/handoff/workflow/website 等） | resolved | — |

### 已收口但目錄已移除（下場註記，非死連結）

- **loop-runner-deepening** — 由 remove-legacy-engine 收口（PR #8–#13 合併）：`agent/engine.ts` 與 `agent/loop/` 已自程式碼刪除，Pi Core Host 為唯一 tool-loop owner（ADR-0045 初始化門檻已過），相關 drift guards 接管敘事。其舊票 #05「manual dev-app parity」隨遺留路徑消失而失去主體。
- **subagents-paid-beta** — 目錄已不存在（git 759d691 清理）；#14 release qualification 殘餘遷記至下方 Remaining blocked，追蹤不因目錄消失而丟失。

## Known residuals（刻意 `[~]`，是紀錄不是欠債）

- **trf#04** — `toolAudit` 未改為投影：它涵蓋回合之外的工具呼叫，純推導會遺失那些記錄（設計決策，票內有說明）。
- **trf#10** — TrajectoryPanel 視窗虛擬化：純函式視窗＋掛載已由 [trajectory-review-closure 01/02](trajectory-review-closure/spec.md) 落地；量測證據與 overscan 定案歸 [03 量測 pass](trajectory-review-closure/issues/03-measurement-pass.md)。
- **trf#11** — 外部 CLI record 的 seam-1 真 CLI 斷言：形狀以純 builder fixture 斷言（`smoke-external-cli-record`）；跑真 CLI 的端到端歸 external-cli-durable-harness effort。
- **parity#18** — `hermes/skills.ts` 以 READ-ONLY 形式留一個版本作為遷移回滾（`check-pi-contract.mts` Guard 3 凍結其 4 個消費者）；收口追蹤於 runtime-contract #17。

## 待維護者裁決 queue（顯式，不埋在雜訊裡）

1. **harness-gap-closure #09** — builtin shell 是否納入 ADR-0022 sandbox 義務（範圍決策）。
2. **runtime-contract #18** — git `--force` 語意移除裁決（傾向 deny + reason，與 gate 一致；若移除需連動 Settings UI／`LlmSettings` 欄位／re-export）。

## Remaining blocked / non-agent

1. **paid-beta #14 release qualification** — `blocked-pending-real-signed-platform-evidence`
   - 需 clean-machine 上 signed 安裝、CLI doctor、N-1→N、entitlement、workflow 實機證據。
   - 目錄已移除；No-Go 記錄可自 git 歷史（759d691 之前的 `.scratch/subagents-paid-beta/evidence/`）取回。
   - 工具仍在 gate 上：`npm run smoke-release-qualification` / `scripts/qualify-release.mts`（無證據則 No-Go）。
2. **runtime-contract #14 Linux bwrap 真機 qualification** — 需 Linux CI 首綠（macOS seatbelt 已完成）；完成後補勾 #14 三框與 #22 的 2.1。
3. **trajectory-review-closure #03 量測 pass** — `需人工處理`：真機 DOM 節點數量測與 overscan 定案，程序文件已備。
4. **Optional polish（非 P0）**
   - `inspectOutbound` 將 sanitize 收進單一 egress API（行為已在 `prepareLlmEgressMessages` + call sites）。
   - seatbelt 擴真實 CLI adapter 網路/nvm 路徑。
   - Playwright 完整點擊 smoke（Chromium 可選）。

## Smoke added this pass

- `app/scripts/smoke-tracker-index-links.mts` — INDEX 相對路徑必須存在（檔案與目錄皆驗、無豁免、訊息列出違規路徑）；fixture 自測含說謊輸入必紅、誠實輸入必綠（已掛 `npm run smoke` 主鏈）
