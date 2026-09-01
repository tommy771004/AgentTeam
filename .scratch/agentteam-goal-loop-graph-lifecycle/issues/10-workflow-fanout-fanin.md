# 10 — Fan-out／fan-in scheduler

**What to build:** 讓所有 ready workflow nodes 在容量與 workspace policy 允許時平行執行，並讓 fan-in barrier 僅在 required inputs verified 後開啟。

**Blocked by:** 09 — 單節點 Workflow Record tracer.

**Status:** resolved

- [x] 無依賴 read nodes 的實際 execution windows 可重疊且受 maxConcurrentNodes 限制。
- [x] Fan-in node 在所有 required upstream artifacts passed 前不可 dispatch。
- [x] Shared write 使用 lease，衝突時 fail closed；需要隔離時使用 isolated worktree。
- [x] Deterministic reducer 不使用模型且 schema mismatch 拒絕輸出。

## Qualification

- `npm run smoke:workflow-scheduler` — 3-way ready set peaks at `maxConcurrentNodes=2`; fan-in opens after all three upstream verification records; shared-write lease denial blocks dispatch; isolated worktree requires a verified grant; deterministic reducer bypasses the agent executor and rejects schema mismatch.
- `npm run smoke:workflow-record`
- `npm run smoke:workflow-graph` — shared writers require bounded, project-relative, unique workspace scopes.
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts` — `workflow-scheduler-v1` is advertised by the shipped Host handshake after `npm run build`.
- `npm run smoke:prod` (37 passed)
- `npm run build`
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- targeted `oxlint` on scheduler, graph, record, protocol, and smoke modules
- `git diff --check`
