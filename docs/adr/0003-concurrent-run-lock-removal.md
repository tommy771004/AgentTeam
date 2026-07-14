# Break the global single-run lock for full N-thread concurrency, capped and flagged

**Status**: accepted

Every run in this product has gone through one `agentEngine` singleton gated by `agentStore.isRunning`, a flat global boolean — documented in `CLAUDE.md` as a load-bearing invariant with an automated smoke drift guard (`W1: entry drift guard`). Busy interactive sources steer or queue; automation sources always queue. We're removing that constraint: any thread — interactive or automated — will be able to run concurrently with any other, not just queue behind or steer the one active run.

This is deliberately the largest architectural change available in this codebase, not an incremental fix, and it directly reverses a documented, smoke-tested invariant. It is being recorded because a future reader of `CLAUDE.md`'s "one global run at a time" language would otherwise have no idea this was superseded deliberately, and because reversing it later (once threads and users depend on concurrent-run semantics) is expensive.

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
- [Ｘ] 驗證結果：`npm run smoke`（含 15 項 scenario、52 項 capability、production modules、marketplace）、`npm run build`、`npx oxlint src` 均通過（lint 僅保留既有 warning）。
