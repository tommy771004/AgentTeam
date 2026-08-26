# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.

## Active frontier (implement next)

| Effort | Spec | Frontier | Notes |
|--------|------|----------|--------|
| **tracker-truth-reconciliation** | [spec.md](tracker-truth-reconciliation/spec.md) | （spec 先行；拆票後更新此格） | **先於其他 effort 排工**。對帳：以 smoke gate 為唯一證據，把各 effort 的 Status／spec 敘述、INDEX 死連結（`subagents-paid-beta/`、`loop-runner-deepening/` 已不存在）、DEV_STATE.md（停在 08-15）對齊程式現實；新增恰好一支 drift guard（INDEX 相對路徑必須存在）；`resolved` 翻牌規則入 `docs/agents/`。harness-gap-closure #09 維持待維護者裁決，本 effort 僅使其顯形。 |
| **trajectory-review-closure** | [spec.md](trajectory-review-closure/spec.md) | [01 窗口模組](trajectory-review-closure/issues/01-window-module.md) · [02 掛載＋guard](trajectory-review-closure/issues/02-mount-and-guard.md) | 01、02 resolved（純函式窗口＋決定論 smoke、InlineRunPanel「執行軌跡」section＋惰性 sessionId 解析＋防復發 drift guard，皆已接 gate）；[03 量測 pass](trajectory-review-closure/issues/03-measurement-pass.md) `需人工處理`——fixture 與程序文件已備，缺真機證據。trf#10 的 `[~]` 已指向本 effort。 |
| **cli-subscription-pi-loop** | [spec.md](cli-subscription-pi-loop/spec.md) | **resolved** | 6/6 tickets done。ADR-0052（accepted）落地：CLI 訂閱 OAuth（openai-codex / anthropic）成為 builtin Pi Core loop 原生 provider 連線——`src/agent/subscriptionCatalog.ts` fail-closed 純投影、Host snapshot bounded catalog（protocol v4，相容 v2/v3 client）、renderer 訂閱 preset＋模型 picker、三支誠實標示 drift guards（已掛鏈）。驗收證據：[qualification.md](cli-subscription-pi-loop/qualification.md)（99 smoke 全綠；真機 E2E：隔離 dir 匯入真 codex OAuth → gpt-5.4-mini 經 Pi loop 回答；snapshot 全文零 credential 形狀）。可重跑：`qualify-subscription-snapshot.mts` / `qualify-subscription-e2e.mts`。 |
| **active-run-reattachment** | [spec.md](active-run-reattachment/spec.md) | [01 真相歸屬決策（resolved）](active-run-reattachment/issues/01-truth-owner-decision.md) · [02 reattach 純協調模組](active-run-reattachment/issues/02-reattach-projection.md) | 01 已決：以 **Pi Core Host journal** 為 active／terminal attachment 唯一真相，main 只 relay，Pi Host Protocol v2→v3；決策見 [decision.md](active-run-reattachment/decision.md)。其餘 10 張 `可交給代理` tickets 實作 renderer reload 的 snapshot+cursor 重建、Host terminal outcome 到既有 app finalization 的 exactly-once 交付、容量重建與真實重啟 e2e。範圍仍不含 main／Host process 重啟，且不新增 coordinator 或第二進度來源。依賴:03←01(resolved)，02 可先行，04←03 → 05←02+04 → 06←05 → 07←04、08←06、09←05、10←06 → 11 收口。 |
| **context-usage-panel** | [spec.md](context-usage-panel/spec.md) | [01 usage 記錄擴充 + Host 補抓](context-usage-panel/issues/01-usage-record-capture.md) | 8 張 `可交給代理` tickets。opencode 式 session 上下文面板：token/cost/快取落在 `step-end` usage（ADR-0039/0049 語意），單一測試接縫為 `projectContextUsage` 純投影。依賴：01 先行 → 02/03 並行 → 04/06/07 並行 → 05←03+04 → 08 收口 |
| **pi-host-tool-and-skill-parity** | [spec.md](pi-host-tool-and-skill-parity/spec.md) | [01 Host extension tool 接縫](pi-host-tool-and-skill-parity/issues/01-host-extension-tool-seam.md) · [02 技能改由 Pi resource loader](pi-host-tool-and-skill-parity/issues/02-skills-via-pi-resource-loader.md) | `可交給代理`。本 session 排查第四題的終局：Host 只有 6 個 builtin tool / 3 個 capability，renderer 有 48 個工具 / 14 個 capability，技能在 localStorage 而 Host 沒有 skill 工具 —— Settings 列的能力在 Electron production 幾乎都叫不動。改為 `pi.registerTool()` 的 Extension Pack + Pi resource loader 的 `additionalSkillPaths`（ADR-0027/0028/0034）。**注意**：止血用的 `agent/piTurnContext.ts` 技能注入牴觸 ADR-0034，由本 effort 排定退場。單一接縫：spawn `dist-electron/pi-host.js` 走 Pi Host Protocol。19 張 `可交給代理`：01 與 02 兩條 tracer 可同時開工（tools / skills 互不相依），04–12 九張只擋在 01 之後可全部並行，13←12，14←03，15←09+14，16←02，17←02+12，18 為 contract（刪 renderer 目錄與 Hermes 技能 + drift guard），19 為完整 qualification |
| **external-cli-durable-harness** | [spec.md](external-cli-durable-harness/spec.md) | [01 External CLI Run Session seam](external-cli-durable-harness/issues/01-expand-external-cli-run-session-seam.md) | 7 張 `可交給代理` tickets；01 先建立 expand seam，之後 02/03/05 可並行，04 依賴 02/03，06 依賴 02，07 為完整 qualification |
| **subdesign-p0-harness-gaps** | [spec.md](subdesign-p0-harness-gaps/spec.md) | [01 Gate evidence contract](subdesign-p0-harness-gaps/issues/01-gate-evidence-contract-fail-closed.md) · [05 Pin 模式端到端](subdesign-p0-harness-gaps/issues/05-pin-mode-end-to-end.md) · [07 Register 快照 + restore](subdesign-p0-harness-gaps/issues/07-register-snapshot-restore.md) | 8 張 `可交給代理` 票、三條並行線（A gates：01→02→03，04←01；B pins：05→06；C snapshots：07→08）；由 `docs/research/claude-design-clones-harness-comparison.md` P0 建議展開 |
| **subdesign-architecture-deepening** | [spec.md](subdesign-architecture-deepening/spec.md) | [01 SubDesign workspace module](subdesign-architecture-deepening/issues/01-deepen-subdesign-workspace-module.md) | 5 張 `可交給代理` tickets；01 與 02 可先行，03/04 依賴 01，05 依賴 02/03 |
| **turn-record-fidelity** | [spec.md](turn-record-fidelity/spec.md) | **resolved** | 12/12 tickets done。Host 端一份有 seq/turn/step 的 Turn Record，答案／模型歷史／UI Projection 三者都從它推導（ADR-0039 合規、ADR-0049/0050 新增）；Pi Host Protocol 升到 v2；`smoke-record-fidelity-qualification` 為完整驗收。兩處刻意未完成：trajectory 的視窗虛擬化、外部 CLI 的真實 seam-1 harness 斷言（各票 `[~]` 有記） |
| **harness-gap-closure** | [spec.md](harness-gap-closure/spec.md) | [01 統一架構敘述](harness-gap-closure/issues/01-unify-architecture-narrative.md) | 由 `docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md` 展開，17 張票。01 應先做（決定後續程式該落在哪一軌）；09 為範圍決策，`待分流` 待維護者裁決 |
| **subagents-paid-beta** | [spec.md](subagents-paid-beta/spec.md) | [14 release qualification](subagents-paid-beta/issues/14-paid-beta-release-qualification.md) | **唯一未完成 P0** — 需真實 signed Win/mac 證據；本地 qualify 腳本 fail-closed No-Go |
| **loop-runner-deepening** | [spec.md](loop-runner-deepening/spec.md) | [05 manual parity](loop-runner-deepening/issues/05-manual-parity-merge-bar.md) | 01–04 resolved（transport seam／stepRun／loopRunner 四 pattern／engine 瘦身+drift guard，engine.ts 1702→808 行，`npm run smoke` 全綠）；僅剩 05 人工 dev-app parity 待做（需人工處理，非代理） |
| 其餘 product efforts | — | — | **resolved**（見下表） |

## Resolved this session chain

| Effort | Status |
|--------|--------|
| tool-invocation-pipeline / review-cleanup | resolved |
| hermes-aligned-runtime + registry-executor-cleanup | resolved |
| outbound-data-gate（01–25 + evidence residual + PolicyAdmin extract） | resolved |
| execution-trust-and-safety / hardening | resolved |
| task-run-coordinator-deepening / single-owner-cleanup | resolved |
| subdesign-project-workspace（含 05 自動化 smoke） | resolved |
| paid-beta 05, 10–13（composer/handoff/workflow/website 等） | resolved |

## Remaining blocked / non-agent

1. **paid-beta #14** — `blocked-pending-real-signed-platform-evidence`  
   - 需 clean-machine 上 signed 安裝、CLI doctor、N-1→N、entitlement、workflow 實機證據。  
   - 產物：`.scratch/subagents-paid-beta/evidence/14-paid-beta-release-qualification-no-go.md`  
   - 工具：`npm` scripts / `qualify-release.mts`（無證據則 No-Go）。

2. **Optional polish（非 P0）**  
   - `inspectOutbound` 將 sanitize 收進單一 egress API（行為已在 `prepareLlmEgressMessages` + call sites）。  
   - seatbelt 擴真實 CLI adapter 網路/nvm 路徑。  
   - Playwright 完整點擊 smoke（Chromium 可選）。

## Smoke added this pass

- `app/scripts/smoke-subdesign-studio.mts` — Studio 契約 + delivery gate + prototype guard（已掛 smoke chain）
