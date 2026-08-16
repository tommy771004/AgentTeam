# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.

## Active frontier (implement next)

| Effort | Spec | Frontier | Notes |
|--------|------|----------|--------|
| **subagents-paid-beta** | [spec.md](subagents-paid-beta/spec.md) | [14 release qualification](subagents-paid-beta/issues/14-paid-beta-release-qualification.md) | **唯一未完成 P0** — 需真實 signed Win/mac 證據；本地 qualify 腳本 fail-closed No-Go |
| **loop-runner-deepening** | [spec.md](loop-runner-deepening/spec.md) | [05 manual parity](loop-runner-deepening/issues/05-manual-parity-merge-bar.md) | 01–04 resolved（transport seam／stepRun／loopRunner 四 pattern／engine 瘦身+drift guard，engine.ts 1702→808 行，`npm run smoke` 全綠）；僅剩 05 人工 dev-app parity 待做（需人工處理，非代理） |
| **first-run-honesty** | [spec.md](first-run-honesty/spec.md) | [12 系列驗收](first-run-honesty/issues/12-series-acceptance.md)（待人工 spot-check） | 系列 1/6 **已實作完成**（01–11 resolved；T12 自動驗收全綠：build/smoke/29 元件測試，僅剩實機 spot-check）：simulation 警示橫幅、首次設定精靈、醫生卡 LLM 檢查、模擬 run 標示（transcript＋摘要卡＋Archive）、指令註冊表共用化＋Command Palette（⌘⇧P）、onboarding tour；**已引入 vitest + testing-library 元件測試 seam** |
| **composer-new-task-flow** | [spec.md](composer-new-task-flow/spec.md) | spec（尚未拆票） | 系列 2/6：composer 基礎/進階分層、排程/事件 tile 改為預填建立動作、DoD 建立時可見可編輯、retry 入 chat、legacy 路由/死檔清理 |
| **settings-registry-restructure** | [spec.md](settings-registry-restructure/spec.md) | spec（尚未拆票） | 系列 3/6：ADR-0032 落實——registry 增 tier/搜尋 keywords metadata、設定搜尋、basic/advanced 分層、近四千行設定頁拆 panel |
| **dod-verified-reports** | [spec.md](dod-verified-reports/spec.md) | spec（尚未拆票） | 系列 4/6：DoD scorecard、從 run journal 渲染可分享驗證報告（MD/HTML 同源）、transcript 匯出；護城河放大的核心 |
| **automation-one-click** | [spec.md](automation-one-click/spec.md) | spec（尚未拆票） | 系列 5/6：對話內建議卡一鍵建立排程/事件規則（與 Automation 頁共用建立路徑），consent-first 不變 |
| **full-localization** | [spec.md](full-localization/spec.md) | spec（尚未拆票） | 系列 6/6：t(key) 抽取層 + zh-TW/en 語言檔、聽寫/選單/通知跟隨、lint 防 hardcode、light theme hack 清償；**建議最後執行** |
| 其餘 product efforts | — | — | **resolved**（見下表） |

> **2026-08-16 新增六份 spec 系列**（ChatGPT Desktop 差距分析 → 產品計畫）。建議執行順序 01→06：`first-run-honesty` → `composer-new-task-flow` → `settings-registry-restructure` → `dod-verified-reports` → `automation-one-click` → `full-localization`（i18n 最後，避免 01–05 變動字串造成重翻）。元件測試 runner 由系列 1/6 引入，後續共用。

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
