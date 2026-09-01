# 06 — Criterion-driven repair loop

**What to build:** 讓 failed criteria 與 artifact impact 決定下一輪修復內容，並在沒有實質進度時於 bounded budget 內停止。

**Blocked by:** 05 — 擴充 deterministic criteria.

**Status:** resolved

- [x] Host 由 failed criteria 與 impacted artifacts 產生 canonical RepairPlan。
- [x] Model continuation items 僅為 proposal，Host 可拒絕、縮限或改寫。
- [x] 相同 acceptance、artifact 與 evidence identity 連續兩輪不變時觸發 no-progress。
- [x] Budget 用盡產生 exhausted，而非 plain success 或無限 retry。

## Qualification

- `npm run smoke:criterion-repair-loop` — canonical targets, bounded proposal hints/rejections, stable progress identity across timestamp/evidence-id churn, artifact progress, and bounded exhaustion.
- `npm run smoke:goal-contract` — shipped Pi Host writes per-iteration RepairPlans, starts the internal repair iteration, then stops unchanged evidence with `repair-no-progress` and failed Goal verdict.
- `npm run smoke:acceptance-gate`
- `npm run smoke:pi-continuation`
- `node --experimental-strip-types scripts/smoke-pi-turn-record.mts`
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts`
- `node --experimental-strip-types scripts/smoke-prod-modules.mts` (37 passed)
- `npm run build`
- targeted `oxlint` on changed production and smoke modules
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- `git diff --check`
