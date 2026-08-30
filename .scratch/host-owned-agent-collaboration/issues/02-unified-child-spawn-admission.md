# 02 — 統一 Child Pi Session spawn admission

**What to build:** `delegate_task` 經唯一 Host-owned Agent Communication Domain 建立獨立 child，套用明確 Context Packet、role、profile、depth、canonical task path、tree budget 與 restrictive-only policy，並立即出現在 ticket 01 的 read model。

**Blocked by:** 01 — Agent tree 與 lifecycle read model.

**Status:** 可交給代理

- [ ] Spawn 成功回傳穩定 agent identity、canonical path、parent edge 與 admitted/queued state
- [ ] 缺少 objective、role、profile、context 或 depth 時 fail closed
- [ ] Depth、concurrency、retained-agent 與 rollout budget 由 Host 以 tree scope 執行
- [ ] Child approval、sandbox、capability、MCP、Outbound Data Gate 與 provider policy 只能比 parent 更嚴
- [ ] Child 只取得明確 Context Packet，不繼承整份 parent transcript
- [ ] Duplicate spawn identity 不會建立兩個 child 或兩個初始 run
- [ ] Spawn、拒絕與 queue_full 都有 Turn Record 與 UI Projection
- [ ] 真 Pi Host spawn smoke 證明 production path，不以 renderer executor 代替
