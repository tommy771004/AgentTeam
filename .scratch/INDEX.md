# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.  
**對帳紀律（2026-08-26 起）**：`resolved` 的證據定義與 DEV_STATE 更新紀律見 `docs/agents/triage-labels.md`。本檔內所有相對路徑引用由 `app/scripts/smoke-tracker-index-links.mts` 守衛（掛 `npm run smoke`）：死路徑會讓 build 紅。

## Active frontier (implement next)

| Effort | Spec | Frontier | Notes |
|--------|------|----------|-------|
| **context-usage-panel** | [spec.md](context-usage-panel/spec.md) | [01 usage 記錄擴充 + Host 補抓](context-usage-panel/issues/01-usage-record-capture.md) | 8 張 `可交給代理` tickets（勾選框核實 0/38 勾，確實未動）。opencode 式 session 上下文面板：token/cost/快取落在 `step-end` usage（ADR-0039/0049 語意），單一測試接縫為 `projectContextUsage` 純投影。依賴：01 先行 → 02/03 並行 → 04/06/07 並行 → 05←03+04 → 08 收口。 |
| **external-cli-durable-harness** | [spec.md](external-cli-durable-harness/spec.md) | [01 External CLI Run Session seam](external-cli-durable-harness/issues/01-expand-external-cli-run-session-seam.md) | 7 張 `可交給代理` tickets（2026-08-26 核實：66 個驗收框全開，確實未動）；01 先建立 expand seam，之後 02/03/05 可並行，04 依賴 02/03，06 依賴 02，07 為完整 qualification。trf#11 的 seam-1 真 CLI 斷言由本 effort 承接。 |
| **harness-gap-closure** | [spec.md](harness-gap-closure/spec.md) | [01 統一架構敘述](harness-gap-closure/issues/01-unify-architecture-narrative.md) | #15 已補 active + retained run selector，不再固定顯示第一個 active run；其 redaction 類別 UX 仍待完成。其餘 frontier 維持 #01、#07、#10、#11 與 #09 範圍裁決。 |
| **pi-agent-runtime-contract** | spec（見目錄） | [#14 Linux bwrap 真機](pi-agent-runtime-contract/issues/14-linux-bubblewrap-builtin-shell-tracer.md) · [#18 git preferences 裁決](pi-agent-runtime-contract/issues/18-git-preferences-reach-no-runtime.md) · [#22 rollup](pi-agent-runtime-contract/issues/22-remaining-work-rollup.md) | Automated test gate 已收口：37 支 deterministic tests 接進主鏈、1 支過時 renderer harness 移除、6 支真機/release qualification 明確列為 manual。殘餘為 #14 Linux CI 首綠、#18 git `--force` 裁決與 #22 對應外部證據。 |
| **subdesign-p0-harness-gaps** | [spec.md](subdesign-p0-harness-gaps/spec.md) | [01 Gate evidence contract](subdesign-p0-harness-gaps/issues/01-gate-evidence-contract-fail-closed.md) · [05 Pin 模式端到端](subdesign-p0-harness-gaps/issues/05-pin-mode-end-to-end.md) · [07 Register 快照 + restore](subdesign-p0-harness-gaps/issues/07-register-snapshot-restore.md) | #05 Host-side selector→range scope、一次性 scopeId 與 patch enforcement 已完成；只剩元件層 idle→pinning→submitted fixture，故未標 resolved。其餘 gates/snapshots 線維持原 frontier。 |
| **subdesign-architecture-deepening** | [spec.md](subdesign-architecture-deepening/spec.md) | [01 SubDesign workspace module](subdesign-architecture-deepening/issues/01-deepen-subdesign-workspace-module.md) | 5 張 `可交給代理` tickets；01 與 02 可先行，03/04 依賴 01，05 依賴 02/03 |

## Resolved this session chain

| Effort | Status | 一 hop 證據 |
|--------|--------|------------|
| verified-working-memory-lifecycle | resolved（15/15 tickets done；[spec.md](verified-working-memory-lifecycle/spec.md)） | [qualification.md](verified-working-memory-lifecycle/qualification.md)：同一 Turn Record 可回答 package／Skill／effect／Checker／state revision；canonical evaluation gate、restart/resume、delegation、candidate-only Meta-Agent 與 owner drift guards 均掛 `npm run smoke` |
| sidebar-navigation-integration | resolved（5/5 tickets done；[spec.md](sidebar-navigation-integration/spec.md)） | [qualification.md](sidebar-navigation-integration/qualification.md)：Radix menu 鍵盤與回焦、desktop/mobile drawer、anti-slop 全項複查；乾淨 worktree `npm run build`、完整 `npm run smoke` 全綠 |
| durable-memory-sqlite-migration | resolved（16/16 tickets done；[spec.md](durable-memory-sqlite-migration/spec.md)） | `smoke-durable-memory-workflow-qualification.mts` 固定 16 個 lifecycle gates 並做 protocol v5／single-authority audit；build、oxlint、完整 smoke 綠；[復原邊界](durable-memory-sqlite-migration/cutover-recovery.md) |
| subscription-surface-hardening | resolved（5/5 tickets done；[spec.md](subscription-surface-hardening/spec.md)） | Settings／catalog／usage hardening smokes 全綠；finalization 啟動語意由 active-run-reattachment #12 owning；tracker #05 已完成三項對帳 |
| trajectory-review-closure | resolved（3/3 tickets done；[spec.md](trajectory-review-closure/spec.md)） | 真 renderer 量測：[evidence](trajectory-review-closure/evidence/measurement-pass.md)；10 頁後 windowed 165 nodes／27 rows，full-map 1,653／275；rowHeight 28、overscan 8 定案 |
| active-run-reattachment | resolved（12/12 tickets done；[spec.md](active-run-reattachment/spec.md)） | protocol attachment journal／renderer bootstrap／finalization CAS／真 Electron restart e2e 皆有票內證據；#12 記錄 terminal finalization 不阻塞啟動 |
| workspace-text-search | resolved（4/4 tickets done；[spec.md](workspace-text-search/spec.md)） | `smoke:workspace-text-search` 19/19 掛主鏈；`npm run build`＋完整 `npm run smoke` 全綠；Browser 實點驗證設定持久化；harness-gap-closure #06 以 superseded 對帳 |
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
3. **Optional polish（非 P0）**
   - `inspectOutbound` 將 sanitize 收進單一 egress API（行為已在 `prepareLlmEgressMessages` + call sites）。
   - seatbelt 擴真實 CLI adapter 網路/nvm 路徑。
   - Playwright 完整點擊 smoke（Chromium 可選）。

## Smoke added this pass

- `app/scripts/smoke-tracker-index-links.mts` — INDEX 相對路徑必須存在（檔案與目錄皆驗、無豁免、訊息列出違規路徑）；fixture 自測含說謊輸入必紅、誠實輸入必綠（已掛 `npm run smoke` 主鏈）
