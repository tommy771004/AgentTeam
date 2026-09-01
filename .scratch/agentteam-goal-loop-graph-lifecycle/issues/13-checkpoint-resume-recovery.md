# 13 — Checkpoint／resume／crash recovery

**What to build:** 讓 Goal／Workflow run 從 exact checkpoint 安全恢復，且在 identity、effect 或 evidence 發生漂移時拒絕 replay。

**Blocked by:** 07 — Goal lifecycle persistence 與 exactly-once finalization; 11 — Node retry 與 impacted-subgraph repair; 12 — Fresh semantic verifier.

**Status:** resolved

- [x] Checkpoint 保存 exact Goal Contract、AcceptanceSnapshot、node attempts、artifacts 與 remaining budgets。
- [x] Resume 重新 admission exact contract digest 與 governing package identity。
- [x] 新 completed effect、artifact drift 或 evidence invalidation 時 fail closed。
- [x] Crash/reload 後不重放已完成 side effects，terminal facts 維持 immutable。

## Qualification

- `npm run smoke:workflow-recovery` — durable store reload、exact Goal/Acceptance/Workflow snapshot、contract/package/effect/artifact/evidence drift fail-closed、once-only resume claim、attempt/budget restoration，以及 completed sibling side effect 不重放。
- `npm run smoke:resilience` — legacy durable checkpoint、safe-park、resume 與 compaction semantics 回歸。
- `npm run smoke:workflow-record`
- `npm run smoke:workflow-scheduler`
- `npm run smoke:workflow-repair`
- `npm run smoke:prod` (37 passed)
- `npm run build`
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- targeted `oxlint` on Goal runtime checkpoint、checkpoint store、workflow scheduler/record 與 recovery smoke。
- `git diff --check`
