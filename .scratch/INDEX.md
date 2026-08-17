# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.

## Active frontier (implement next)

| Effort | Spec | Frontier | Notes |
|--------|------|----------|--------|
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
