# 13 — Checkpoint／resume／crash recovery

**What to build:** 讓 Goal／Workflow run 從 exact checkpoint 安全恢復，且在 identity、effect 或 evidence 發生漂移時拒絕 replay。

**Blocked by:** 07 — Goal lifecycle persistence 與 exactly-once finalization; 11 — Node retry 與 impacted-subgraph repair; 12 — Fresh semantic verifier.

**Status:** ready-for-agent

- [ ] Checkpoint 保存 exact Goal Contract、AcceptanceSnapshot、node attempts、artifacts 與 remaining budgets。
- [ ] Resume 重新 admission exact contract digest 與 governing package identity。
- [ ] 新 completed effect、artifact drift 或 evidence invalidation 時 fail closed。
- [ ] Crash/reload 後不重放已完成 side effects，terminal facts 維持 immutable。

