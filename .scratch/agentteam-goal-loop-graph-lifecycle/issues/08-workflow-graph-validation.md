# 08 — Workflow Graph contract 與 admission validator

**What to build:** 讓 workflow definitions 在執行前成為 immutable、可持久化且 fail-closed 的資料依賴圖，而不是從 Agent Tree 或文字提示推導。

**Blocked by:** 03 — Goal Contract admission 與 fail-closed.

**Status:** ready-for-agent

- [ ] Cycle、missing artifact ref、duplicate output、unreachable terminal 與 invalid workspace policy fail closed。
- [ ] 無 input binding 或 barrier justification 的 dependsOn 產生 fake-edge warning。
- [ ] Definition 經 validate、freeze、digest 並受 concurrency、attempt、wall-clock budget 約束。
- [ ] Workflow Graph dependency 不由 agent parent-child relationship 推導。

