# 08 — Workflow Graph contract 與 admission validator

**What to build:** 讓 workflow definitions 在執行前成為 immutable、可持久化且 fail-closed 的資料依賴圖，而不是從 Agent Tree 或文字提示推導。

**Blocked by:** 03 — Goal Contract admission 與 fail-closed.

**Status:** resolved

- [x] Cycle、missing artifact ref、duplicate output、unreachable terminal 與 invalid workspace policy fail closed。
- [x] 無 input binding 或 barrier justification 的 dependsOn 產生 fake-edge warning。
- [x] Definition 經 validate、freeze、digest 並受 concurrency、attempt、wall-clock budget 約束。
- [x] Workflow Graph dependency 不由 agent parent-child relationship 推導。

## Qualification

- `npm run smoke:workflow-graph` — deterministic digest/freeze/JSON persistence; cycle, missing artifact, duplicate output, unreachable terminal, workspace and all budget failures; fake-edge warning/barrier justification; Agent Tree `parentId` rejected as an unknown graph field.
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts` — `workflow-graph-v1` is advertised and negotiated through the shipped Host handshake.
- `node --experimental-strip-types scripts/smoke-prod-modules.mts` (37 passed)
- `npm run build`
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- targeted `oxlint` on graph, protocol, supervisor, main, and smoke modules
- `git diff --check`
