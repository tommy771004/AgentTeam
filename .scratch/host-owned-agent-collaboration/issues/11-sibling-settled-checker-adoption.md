# 11 — Sibling-settled Checker adoption

**What to build:** Parent 收到 goal-directed child completion 後，只在相關 sibling effects settled 且 workspace revision 穩定時執行 Host Checker；通過才採用 delegated goal，stale、invalidated 或 unverifiable observation 保留但不推進 Working State。

**Blocked by:** 06 — One-hop child completion delivery; 09 — Host-owned write scope 與 conflict notification; 10 — Verified worktree isolation.

**Status:** 可交給代理

- [ ] Child final text、message 或 planned state 單獨不能完成 parent goal
- [ ] Checker 驗證 trusted execution evidence、completion predicate、base revision 與 current applicability
- [ ] Parent 在 sibling effects/leases 未 settled 時得到 pending 而非錯誤 pass
- [ ] Stale/invalidated result 寫入 observation/check，但 parent goal 維持未完成
- [ ] 同一 delegation/result 只能採用一次，replay/restart 不重複 revision
- [ ] Isolated worktree evidence 在 apply 前後使用正確 workspace identity 與 revision
- [ ] Adoption outcome 回到 mailbox、Turn Record、Working State 與 UI Projection
- [ ] 真 Pi goal delegation smoke 覆蓋 pass、stale、missing evidence 與 sibling race
