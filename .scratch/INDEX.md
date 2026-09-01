# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.  
**對帳紀律（2026-08-26 起）**：`resolved` 的證據定義與 DEV_STATE 更新紀律見 `docs/agents/triage-labels.md`。本檔內所有相對路徑引用由 `app/scripts/smoke-tracker-index-links.mts` 守衛（掛 `npm run smoke`）：死路徑會讓 build 紅。

## Active frontier (implement next)

| Effort | Spec | Frontier | Notes |
|--------|------|----------|-------|
| **codex-aligned-personalization-instructions** | [spec.md](codex-aligned-personalization-instructions/spec.md) | [11 External CLI native discovery](codex-aligned-personalization-instructions/issues/11-external-cli-instruction-delivery-modes.md) | 2026-09-01 fresh 真機重跑：Codex CLI 0.152.0 的 native marker、checkpoint／restart projection／record 通過，qualified（native mode，非 exact parity）；Claude Code 2.1.246 仍 auth unavailable。[qualification](codex-aligned-personalization-instructions/qualification.md) 維持 needs-info。 |
| **context-usage-panel** | [spec.md](context-usage-panel/spec.md) | [qualification](context-usage-panel/qualification.md) | resolved；2026-09-01 已完成 typecheck、投影／lifecycle smoke、lint、production 元件 rendered UI、external 降級與 legacy replay qualification。 |
| **external-cli-durable-harness** | [spec.md](external-cli-durable-harness/spec.md) | [07 qualification](external-cli-durable-harness/issues/07-conversation-concurrency-release-qualification.md) | Durable harness 已落地；2026-09-01 [fresh real CLI report](external-cli-durable-harness/evidence/real-cli-qualification.md) 為 Codex `qualified`（native mode）、Claude `auth_unavailable`。其餘 provider 本輪未重跑，故維持 open。 |
| **pi-agent-runtime-contract** | spec（見目錄） | [#14 Linux bwrap 真機](pi-agent-runtime-contract/issues/14-linux-bubblewrap-builtin-shell-tracer.md) · [#22 rollup](pi-agent-runtime-contract/issues/22-remaining-work-rollup.md) | Automated test gate 已收口。#18 已採 Host enforcement：force push deny、不靜默改寫、gate 前套用，focused smoke 12/12（含真實 turn）通過；剩餘 frontier 是 #14 Linux CI 首綠與 #22 外部證據。 |
| **subdesign-p0-harness-gaps** | [spec.md](subdesign-p0-harness-gaps/spec.md) | resolved | #01–#08 已收口。Gate 僅能在 Critique stage 執行、五項 Host measurement 與 score provenance 已完成；pinned-comment audit、immutable snapshot restore 與任意兩版 side-by-side diff 均有 shipped smoke 證據。 |

## Resolved this session chain

| Effort | Status | 一 hop 證據 |
|--------|--------|------------|
| release-qualification-hardening | resolved（20/20 tickets done；[spec.md](release-qualification-hardening/spec.md)） | [qualification.md](release-qualification-hardening/qualification.md)：repository hardening owning gates、readiness vocabulary、build/dist-only topology、tracker links 與 full smoke；外部 signed-platform evidence 缺少，Paid Beta 誠實維持 NO-GO（0/49） |
| harness-gap-closure | resolved（17/17 tickets done；[spec.md](harness-gap-closure/spec.md)） | #01 architecture narrative 已對齊 `runTask` + Pi Host 並由 legacy zero-reference guard 鎖定；#07／#10／#11／#15 以 shipped modules 與 focused smokes 對帳，#09 sandbox scope 已依 ADR-0047／0051 收口 |
| host-owned-agent-collaboration | resolved（15/15 tickets done；[spec.md](host-owned-agent-collaboration/spec.md)） | [qualification.md](host-owned-agent-collaboration/qualification.md)：Host-owned agent tree/mailbox/follow-up/wait/conflict/worktree/adoption、Turn Record UI attribution、build/oxlint/full smoke/package-time smoke 全綠；x64/arm64 local unsigned DMG 已產生，signed/notarized publication 仍 fail closed 等待 Apple credentials |
| usage-ledger | resolved（[spec.md](usage-ledger/spec.md)） | `smoke-usage-ledger.mts`：settlement single ingress、runId idempotent upsert、atomic publish、archive one-shot backfill 與純 projection；[desktop](usage-ledger/evidence/usage-desktop.png)／[narrow](usage-ledger/evidence/usage-narrow.png) rendered evidence |
| subdesign-architecture-deepening | resolved（5/5 tickets done；[spec.md](subdesign-architecture-deepening/spec.md)） | [qualification.md](subdesign-architecture-deepening/qualification.md)：workspace/provider/streaming/pack 四個 deep modules，加上 Pi Host sessions/runs/tools/approvals domain extraction、explicit cursor commit、deletion guard、build 與 full smoke 全綠 |
| adaptive-agent-run-status-surface | resolved（1/1 ticket done；[spec.md](adaptive-agent-run-status-surface/spec.md)） | [qualification.md](adaptive-agent-run-status-surface/qualification.md)：bounded 執行狀態、自適應 progress/activity/attention/summary、hostile context exclusion、reload/archive/replay、真 renderer 與 full smoke 全綠 |
| run-review-workspace | resolved（15/15 tickets done；[spec.md](run-review-workspace/spec.md)） | [qualification.md](run-review-workspace/qualification.md)：immutable A→B、reload/restart、comments、CAS mutation/delivery、desktop/narrow UI、真 Electron builtin + Codex CLI、build/oxlint/full smoke 全綠 |
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
| cli-subscription-pi-loop | resolved（7/7 tickets done） | [qualification.md](cli-subscription-pi-loop/qualification.md)：原訂閱 E2E＋2026-09-01 OAuth rotation follow-up；隔離環境先重現 invalidated token，再由同一 Host 無重啟同步目前 CLI credential 並回答 |
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
- **parity#18** — [`hermes/skills.ts` authoring compatibility](hermes-skills-authoring-compatibility.md) 仍供 Learning／Settings 編輯後單向同步 Host；它不是 READ-ONLY，也不是 runtime discovery authority。Guard 3 現完整凍結 12 個 consumer，期限明確延至 1.3.0 前。
- **vendored Pi TODO/FIXME** — [upstream debt inventory](vendored-pi-upstream-debt.md) 由 Pi sync manifest 與 sync-evidence gate 對帳；本專案不直接修改 upstream workaround／skipped provider tests。

## 待維護者裁決 queue（顯式，不埋在雜訊裡）

1. **harness-gap-closure #09** — builtin shell 是否納入 ADR-0022 sandbox 義務（範圍決策）。
2. （已裁決）**runtime-contract #18** — 採 Host enforcement：不允許時 deny + reason，不靜默移除 `--force`；focused smoke 12/12。

## Remaining blocked / non-agent

1. **paid-beta #14 release qualification** — `blocked-pending-real-signed-platform-evidence`
   - 需 clean-machine 上 signed 安裝、CLI doctor、N-1→N、entitlement、workflow 實機證據。
   - 2026-09-01 重跑 [`qualify-release.mts`](../app/scripts/qualify-release.mts) 為 **NO-GO（0/49）**；retained report 見 [`paid-beta-qualification.md`](../app/release-evidence/paid-beta-qualification.md)。
   - 目錄已移除；歷史 No-Go 記錄可自 git 歷史（759d691 之前的 `.scratch/subagents-paid-beta/evidence/`）取回。
2. **runtime-contract #14 Linux bwrap 真機 qualification** — 需 Linux CI 首綠（macOS seatbelt 已完成）；完成後補勾 #14 三框與 #22 的 2.1。
3. **Optional polish（非 P0）**
   - `inspectOutbound` 將 sanitize 收進單一 egress API（行為已在 `prepareLlmEgressMessages` + call sites）。
   - seatbelt 擴真實 CLI adapter 網路/nvm 路徑。
   - Playwright 完整點擊 smoke（Chromium 可選）。

## Smoke added this pass

- `app/scripts/smoke-tracker-index-links.mts` — INDEX 相對路徑必須存在（檔案與目錄皆驗、無豁免、訊息列出違規路徑）；fixture 自測含說謊輸入必紅、誠實輸入必綠（已掛 `npm run smoke` 主鏈）
