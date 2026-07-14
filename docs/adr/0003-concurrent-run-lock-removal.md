# Break the global single-run lock for full N-thread concurrency, capped and flagged

**Status**: accepted · **implemented** (2026-07-14; docs aligned in Phase 6 of `TASK_AGENT_WORKFLOW_INTEGRATION_PLAN_2026-07-14.md`)

## Product rule (current)

- **Default**: single-run behavior (`settings.concurrentRunsEnabled: false`) — users keep the historical UX.
- **Opt-in**: capped per-app concurrency (`maxConcurrentRuns`, default 4, typically 2–8). Capacity is owned by `taskRunCoordinator` / `agentStore` run registry (`runId`), not a sole global boolean.
- **Overflow**: queue/steer via existing `resolveBusyPolicy` + `runQueue` (not hard-fail).
- Presentation, HITL, cancel, and activity are **run-scoped** (Phase 1 of the task-agent plan).

Historical note: every run once went through one `agentEngine` singleton gated by flat `agentStore.isRunning`. Busy interactive sources steered or queued; automation always queued. That constraint is now **opt-out single-run by default, concurrent when flagged** — recorded so readers of older "one global run" language know it was superseded deliberately.

## Decision

- **Concurrency shape**: full N-thread concurrency was chosen over a narrower "one interactive run + a background/automation lane" model, after the narrower model was presented and explicitly declined.
- **Safety net**: capped concurrent runs (a small fixed ceiling; runs past the cap fall back to today's queue/steer behavior rather than failing) and shipped behind a settings toggle defaulting to **off** — matching this repo's existing rollout pattern for other large-blast-radius features (`subAgentsEnabled` defaults off; `approvalMode` defaults to the conservative `auto`). This was reached only after two rounds of the unbounded/always-on alternative being chosen and then reconsidered on direct confirmation — see Considered Options.
- **HITL routing**: `PermissionAskRequest` gets `threadId`/`runId` fields. The UI stays a single modal + FIFO queue (no redesign into per-thread inline approval panels) — asks from different concurrent runs now route correctly back to the run that asked, instead of leaking across runs, without a new UI surface.
- **Session-allow scope**: `permissionAskStore.sessionAllow` (today one global "approve for rest of session" flag) becomes keyed by `threadId`. A blanket approval granted while reviewing one thread's tool calls must not silently authorize a different, unrelated thread's tool calls the user never saw — approval scope must match review scope.

## Consequences / follow-on engineering

Per a pre-implementation architecture inventory, this touches at minimum: `AgentLoopEngine` (singleton → per-run instances, since `state`/`aborted`/HITL continuation callbacks are currently instance fields), `agentStore.isRunning` (flat boolean → concurrent-run tracking with the cap enforced), `threadStore.runningThreadId` (singular scalar → a set), the CLI-cancel IPC path (`cli:cancel` currently kills *all* `cli-agent`-tagged processes with no run targeting — must become run-scoped), the `W1` drift guard, and the `smoke-scenario-e2e.mjs` mock harness (which reimplements the single global-flag busy/queue semantics and needs a concurrent-run-aware rewrite). Project-root and pty/shell already support per-run overrides and are not blockers. `agent/supervisor.ts` budgets are already stateless/per-call and are not blockers.

## Considered and rejected

- **Bounded two-lane model** (foreground interactive run stays exactly as today; only background/automation sources get a second concurrent lane) — presented as the recommended narrower option; rejected in favor of full N-thread concurrency.
- **Unbounded, always-on** (no cap, no settings toggle) — chosen initially, then reconsidered after the consequence was named explicitly (every existing user gets N-simultaneous-run behavior immediately with no opt-out and no resource ceiling) and replaced with the capped + flagged version above.
- **Per-thread inline HITL approval UI** (multiple simultaneous approval panels, one per active thread) — rejected in favor of tagging requests and keeping the single modal, to avoid bundling a HITL UI redesign into an already large change.

## Implementation status

- [Ｘ] 已實作並驗證：`AgentEngineRegistry` 為每個 `runId` 建立獨立 engine；`agentStore` 以 active run registry 實作預設關閉、上限 2–8（預設 4）的並行容量；queue drain 會填滿可用 slot；thread / activity / project / custom shell context 均以 run identity 傳遞。
- [Ｘ] 已實作並驗證：HITL request 帶有 `threadId` / `runId`，single FIFO modal 依 thread scope 保存 session-allow、依 run scope 保存 audit / cancel；CLI / bash / OpenCode cancel 皆可 targeted；`runningThreadIds` 與 W1 smoke harness 已改為 concurrent-aware。
- [Ｘ] 已與 lifecycle plan 對齊：`taskRunCoordinator` 擁有 capacity／finalization；`AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` 改為「預設單 run、可設定上限的 per-run concurrency」（Phase 6）。
- [Ｘ] 驗證結果：`npm run smoke`（scenario E2E、capability smoke、production modules、marketplace）、`npm run build`、`npx oxlint src` 均通過（lint 僅保留既有 warning）。
