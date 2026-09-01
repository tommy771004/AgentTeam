# 06 — Criterion-driven repair loop

**What to build:** 讓 failed criteria 與 artifact impact 決定下一輪修復內容，並在沒有實質進度時於 bounded budget 內停止。

**Blocked by:** 05 — 擴充 deterministic criteria.

**Status:** ready-for-agent

- [ ] Host 由 failed criteria 與 impacted artifacts 產生 canonical RepairPlan。
- [ ] Model continuation items 僅為 proposal，Host 可拒絕、縮限或改寫。
- [ ] 相同 acceptance、artifact 與 evidence identity 連續兩輪不變時觸發 no-progress。
- [ ] Budget 用盡產生 exhausted，而非 plain success 或無限 retry。

