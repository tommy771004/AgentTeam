# 09 — 單節點 Workflow Record tracer

**What to build:** 讓一個 workflow node 從 ready、attempt dispatch、agent execution、artifact publish、verification 到 terminal 具備 Host-owned append-only record。

**Blocked by:** 07 — Goal lifecycle persistence 與 exactly-once finalization; 08 — Workflow Graph contract 與 admission validator.

**Status:** ready-for-agent

- [ ] Node attempt 具 nodeRunId、attemptId 與可選 agentSessionId correlation。
- [ ] Workflow Record append-only 並保存 ordered orchestration metadata。
- [ ] Workflow Record 僅引用 Turn Record ranges，不複製 transcript 或 reasoning。
- [ ] Child completed 僅產生 observation，須經 node verification 才算 passed。

