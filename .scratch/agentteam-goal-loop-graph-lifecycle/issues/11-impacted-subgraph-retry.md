# 11 — Node retry 與 impacted-subgraph repair

**What to build:** 讓 workflow failure 只建立新的 bounded attempt 並重跑真正受影響的 branch，不重新執行已通過且無依賴影響的 side effects。

**Blocked by:** 06 — Criterion-driven repair loop; 10 — Fan-out／fan-in scheduler.

**Status:** ready-for-agent

- [ ] 每次 retry 建立新的 immutable attemptId，舊 attempt history 不覆寫。
- [ ] Branch failure 只 invalidates impacted node 與 downstream transitive closure。
- [ ] 已通過且不受影響的 branch 不重跑。
- [ ] Retry、total attempts 與 wall-clock budgets 一致 fail closed。

