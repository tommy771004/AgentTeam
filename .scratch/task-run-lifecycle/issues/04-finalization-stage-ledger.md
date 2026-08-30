# 04 — Execution terminal 與 finalization stage ledger

**What to build:** 所有 run outcome 都先形成不可逆 execution terminal，再由 durable stage ledger 推進 app finalization；正常與 early path 不再用不同順序表示「完成」。

**Blocked by:** 03 — Immutable admission snapshot 與 queue lineage

**Status:** 可交給代理

- [ ] execution terminal 與 app-finalization status 是兩個明確狀態，late success 不會復活 cancelled、failed 或 interrupted run
- [ ] normal、early deny、dispatch exception、cancel、timeout、Host restart 與 renderer reload 共用同一 stage vocabulary
- [ ] review、summary、afterRun、archive、memory/evidence、delivery、cleanup 與 Host ack 各有 bounded receipt
- [ ] 已完成 stage 不重做；非必要 projection failure 不改寫 execution outcome
- [ ] crash point 與 competing finalizer smoke 證明每個 durable stage 最多一次產生 effect
