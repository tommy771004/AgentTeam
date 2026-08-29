# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.  
**對帳紀律（2026-08-26 起）**：`resolved` 的證據定義與 DEV_STATE 更新紀律見 `docs/agents/triage-labels.md`。本檔內所有相對路徑引用由 `app/scripts/smoke-tracker-index-links.mts` 守衛（掛 `npm run smoke`）：死路徑會讓 build 紅。

## Active frontier (implement next)

| Effort | Spec | Frontier | Notes |
|--------|------|----------|-------|
| **codex-aligned-personalization-instructions** | [spec.md](codex-aligned-personalization-instructions/spec.md) | [01 Host-owned global instructions](codex-aligned-personalization-instructions/issues/01-host-owned-global-instructions-vertical-slice.md) | 13 張 tracer-bullet tickets 已發布；frontier 為 #01。以「個人化」為唯一入口；全域指令由獨立 Host SQLite authority 保存，專案 AGENTS／CLAUDE 維持 filesystem canonical，Task run admission 凍結可由 Turn Record 重建的 instruction snapshot。 |
| **context-usage-panel** | [spec.md](context-usage-panel/spec.md) | [08 qualification](context-usage-panel/issues/08-qualification.md) | 實作已存在：`ContextUsagePanel`、`projectContextUsage` 與 context projection smoke 均在主鏈；2026-08-28 focused smoke 通過。票內 acceptance 尚未逐條對帳，手動 UI／舊記錄 replay 證據仍須補齊，故不宣稱 resolved。 |
| **external-cli-durable-harness** | [spec.md](external-cli-durable-harness/spec.md) | [07 qualification](external-cli-durable-harness/issues/07-conversation-concurrency-release-qualification.md) | Durable harness 已落地且 focused smoke 通過。2026-08-28 真機 Codex 0.150.1、Claude 2.1.246 execution/checkpoint/restart/record qualification 通過；Grok blocked-auth，Gemini／Cursor 未安裝，故維持 open。證據見 [real CLI report](external-cli-durable-harness/evidence/real-cli-qualification.md)。 |
| **harness-gap-closure** | [spec.md](harness-gap-closure/spec.md) | [01 統一架構敘述](harness-gap-closure/issues/01-unify-architecture-narrative.md) | 2026-08-28 對帳後 #02–#05、#08、#12–#14、#16–#17 依既有主鏈 evidence 翻 resolved；#15 已補 active + retained run selector。frontier 維持 #01、#07、#10、#11、#15 redaction UX 與 #09 範圍裁決。 |
| **pi-agent-runtime-contract** | spec（見目錄） | [#14 Linux bwrap 真機](pi-agent-runtime-contract/issues/14-linux-bubblewrap-builtin-shell-tracer.md) · [#22 rollup](pi-agent-runtime-contract/issues/22-remaining-work-rollup.md) | Automated test gate 已收口。#18 已採 Host enforcement：force push deny、不靜默改寫、gate 前套用，focused smoke 12/12（含真實 turn）通過；剩餘 frontier 是 #14 Linux CI 首綠與 #22 外部證據。 |
| **subdesign-p0-harness-gaps** | [spec.md](subdesign-p0-harness-gaps/spec.md) | [01 Gate evidence contract](subdesign-p0-harness-gaps/issues/01-gate-evidence-contract-fail-closed.md) | #05–#07 已於 2026-08-28 收口，含 canonical pinned-comment audit 與 UI 回查。Pi Core gate 已移除模型 verdict，改由 Electron main 真實 runner 量測並簽章；尚需依 #01 原票語意對帳 store「拒絕」與目前 normalizer「降級 needs-revision」差異。 |
| **subdesign-architecture-deepening** | [spec.md](subdesign-architecture-deepening/spec.md) | [05 Pi Host protocol dispatch](subdesign-architecture-deepening/issues/05-deepen-pi-host-protocol-dispatch.md) | #01–#04 resolved：workspace controller、provider registry、streaming UI projection 與 atomic pack application 已有主鏈 smoke。#05 已完成 explicit cursor commit 與 capability/resources/extensions domains，仍需 sessions/runs/tools deletion-test extraction，故保持 open。 |

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
- **vendored Pi TODO/FIXME** — `vendor/pi/packages/ai/src/api/openai-codex-responses.ts:961` 與 vendored image/token tests 的 TODO 屬 upstream-owned code；本輪不改 vendor，待下一次 upstream sync 對帳。

## 待維護者裁決 queue（顯式，不埋在雜訊裡）

1. **harness-gap-closure #09** — builtin shell 是否納入 ADR-0022 sandbox 義務（範圍決策）。
2. （已裁決）**runtime-contract #18** — 採 Host enforcement：不允許時 deny + reason，不靜默移除 `--force`；focused smoke 12/12。

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
