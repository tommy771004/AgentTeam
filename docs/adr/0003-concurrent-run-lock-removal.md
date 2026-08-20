# Break the global single-run lock for independent conversation execution

**Status**: accepted · **implemented** (2026-07-14; docs aligned in Phase 6 of `TASK_AGENT_WORKFLOW_INTEGRATION_PLAN_2026-07-14.md`)

## Product rule (current)

- **Different conversations**: execute independently without an opt-in switch.
- **Capacity**: capped per app by `maxConcurrentRuns` (default 4, typically 2–8). Capacity is owned by the `taskRunCoordinator` / `agentStore` run registry (`runId`), not a sole global boolean.
- **Same conversation**: remains ordered; follow-ups steer or queue instead of overlapping the same thread.
- **Overflow**: queue/steer via existing `resolveBusyPolicy` + `runQueue` (not hard-fail).
- Presentation, HITL, cancel, and activity are **run-scoped** (Phase 1 of the task-agent plan).

Historical note: every run once went through one `agentEngine` singleton gated by flat `agentStore.isRunning`, and the first concurrency rollout retained an opt-in flag. Both forms of app-wide locking are superseded: only same-thread ordering and the bounded safety cap may delay admission.

## Decision

- **Concurrency shape**: full N-thread concurrency was chosen over a narrower "one interactive run + a background/automation lane" model, after the narrower model was presented and explicitly declined.
- **Safety net**: bounded always-on concurrency. Runs past the small fixed ceiling fall back to queue/steer behavior rather than failing; same-thread runs never overlap.
- **HITL routing**: `PermissionAskRequest` gets `threadId`/`runId` fields. The UI stays a single modal + FIFO queue (no redesign into per-thread inline approval panels) — asks from different concurrent runs now route correctly back to the run that asked, instead of leaking across runs, without a new UI surface.
- **Session-allow scope**: `permissionAskStore.sessionAllow` (today one global "approve for rest of session" flag) becomes keyed by `threadId`. A blanket approval granted while reviewing one thread's tool calls must not silently authorize a different, unrelated thread's tool calls the user never saw — approval scope must match review scope.

## Consequences / follow-on engineering

The implementation required `AgentLoopEngine` instances per run, concurrent-run tracking in `agentStore`, a set of running thread ids, run-targeted CLI cancellation, and concurrent-aware smoke harnesses. Project-root and pty/shell context are also carried per run.

## Considered and rejected

- **Bounded two-lane model** (foreground interactive run stays exactly as today; only background/automation sources get a second concurrent lane) — presented as the recommended narrower option; rejected in favor of full N-thread concurrency.
- **Unbounded, always-on** — rejected because no resource ceiling could overload local or LLM runners. The accepted shape is bounded always-on concurrency.
- **Per-thread inline HITL approval UI** (multiple simultaneous approval panels, one per active thread) — rejected in favor of tagging requests and keeping the single modal, to avoid bundling a HITL UI redesign into an already large change.

## Implementation status

- [Ｘ] 已實作並驗證：`AgentEngineRegistry` 為每個 `runId` 建立獨立 engine；`agentStore` 以 active run registry 實作不同對話預設獨立、上限 2–8（預設 4）的並行容量；queue drain 會填滿可用 slot；thread / activity / project / custom shell context 均以 run identity 傳遞。
- [Ｘ] 已實作並驗證：HITL request 帶有 `threadId` / `runId`，single FIFO modal 依 thread scope 保存 session-allow、依 run scope 保存 audit / cancel；CLI / bash / OpenCode cancel 皆可 targeted；`runningThreadIds` 與 W1 smoke harness 已改為 concurrent-aware。
- [Ｘ] 已與 lifecycle plan 對齊：`taskRunCoordinator` 擁有 capacity／finalization；不同對話各自執行，同一對話 follow-up 保持有序。
- [Ｘ] 驗證結果：`npm run smoke`（scenario E2E、capability smoke、production modules、marketplace）、`npm run build`、`npx oxlint src` 均通過（lint 僅保留既有 warning）。
