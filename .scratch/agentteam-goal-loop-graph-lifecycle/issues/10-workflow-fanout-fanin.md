# 10 — Fan-out／fan-in scheduler

**What to build:** 讓所有 ready workflow nodes 在容量與 workspace policy 允許時平行執行，並讓 fan-in barrier 僅在 required inputs verified 後開啟。

**Blocked by:** 09 — 單節點 Workflow Record tracer.

**Status:** ready-for-agent

- [ ] 無依賴 read nodes 的實際 execution windows 可重疊且受 maxConcurrentNodes 限制。
- [ ] Fan-in node 在所有 required upstream artifacts passed 前不可 dispatch。
- [ ] Shared write 使用 lease，衝突時 fail closed；需要隔離時使用 isolated worktree。
- [ ] Deterministic reducer 不使用模型且 schema mismatch 拒絕輸出。

