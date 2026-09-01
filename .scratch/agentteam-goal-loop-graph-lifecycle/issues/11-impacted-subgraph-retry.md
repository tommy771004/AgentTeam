# 11 — Node retry 與 impacted-subgraph repair

**What to build:** 讓 workflow failure 只建立新的 bounded attempt 並重跑真正受影響的 branch，不重新執行已通過且無依賴影響的 side effects。

**Blocked by:** 06 — Criterion-driven repair loop; 10 — Fan-out／fan-in scheduler.

**Status:** resolved

- [x] 每次 retry 建立新的 immutable attemptId，舊 attempt history 不覆寫。
- [x] Branch failure 只 invalidates impacted node 與 downstream transitive closure。
- [x] 已通過且不受影響的 branch 不重跑。
- [x] Retry、total attempts 與 wall-clock budgets 一致 fail closed。

## Qualification

- `npm run smoke:workflow-repair` — Host `RepairPlan` maps a failed criterion to the real `left` node; invalidation records only `left → join`; immutable attempt history advances both to `attempt:2`; the passed `right` sibling remains at one execution; per-node, total-attempt, and wall-clock budget failures occur before any partial invalidation.
- `npm run smoke:workflow-scheduler`
- `npm run smoke:criterion-repair-loop` — non-graph criterion-id fallback and no-progress behavior remain intact.
- `npm run smoke:prod` (37 passed)
- `npm run build`
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- targeted `oxlint` on scheduler, Acceptance/Repair/Workflow Record contracts, and repair smoke
- `git diff --check`
