# 09 — 單節點 Workflow Record tracer

**What to build:** 讓一個 workflow node 從 ready、attempt dispatch、agent execution、artifact publish、verification 到 terminal 具備 Host-owned append-only record。

**Blocked by:** 07 — Goal lifecycle persistence 與 exactly-once finalization; 08 — Workflow Graph contract 與 admission validator.

**Status:** resolved

- [x] Node attempt 具 nodeRunId、attemptId 與可選 agentSessionId correlation。
- [x] Workflow Record append-only 並保存 ordered orchestration metadata。
- [x] Workflow Record 僅引用 Turn Record ranges，不複製 transcript 或 reasoning。
- [x] Child completed 僅產生 observation，須經 node verification 才算 passed。

## Qualification

- `npm run smoke:workflow-record` — Host-owned ordered ledger、snapshot restore、node/attempt/session correlation、required artifact gate、observation-only child completion、Turn Record range refs、transcript/reasoning exclusion。
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts` — `workflow-record-v1` is advertised by the shipped Host handshake after `npm run build`.
- `npm run smoke:workflow-graph`
- `npm run smoke:prod` (37 passed)
- `npm run build`
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- targeted `oxlint` on Workflow Record, tracer, protocol, supervisor, main, and smoke modules
- `git diff --check`
