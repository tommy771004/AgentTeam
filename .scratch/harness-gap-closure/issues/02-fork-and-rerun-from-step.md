# 02 — Fork a run and rerun from step N

**What to build:** Give the user an action that forks a recorded run at a chosen step, lets them adjust, and reruns from there through the normal coordinator ingress.

**Blocked by:** None.

**Status:** 可交給代理

This is the highest-frequency action for an agent product and the product has no entry point for it, even though all the data exists. `agent/runJournal.ts`, `electron/rewindBridge.ts`, and `agent/compactionCheckpoint.ts` already hold what is needed, and ADR-0042 already decided that retries start only from a replay-safe checkpoint. The user-facing side is split across four separate pages — `LogsPage`, `RecordsPage`, `ArchivePage`, `FailedPage` — none of which offers "fork from step N". `sessionSearch.ts` exists but serves the agent, not the user.

- [x] A run's recorded steps are selectable, and forking from a selected step is a visible action in `ExecutionPage` and `RecordsPage`.
- [x] The fork point is constrained to a replay-safe checkpoint, per ADR-0042; non-replay-safe points are refused with a stated reason rather than silently adjusted.
- [x] The forked rerun enters through `agent/taskRunCoordinator.ts` `runTask` with an explicit `sourceKind` and truncated history. Nothing calls `dispatchThreadTask` or `startExecution`.
- [x] The forked run obeys the same capacity, busy-policy, queue, and dedupe rules as any other run.
- [x] Finalization for a forked run happens exactly once and in the fixed order (summary → afterRun → Archive → onSettled → release → drain).
- [x] The original run's record is preserved; a fork does not overwrite or mutate its parent.
- [x] `npm run smoke:coordinator` asserts single, correctly ordered finalization for a forked run.

Files: `app/src/pages/ExecutionPage.tsx`, `app/src/pages/RecordsPage.tsx`, `app/src/agent/taskRunCoordinator.ts`, `app/src/agent/runJournal.ts`, `app/src/agent/compactionCheckpoint.ts`, `app/electron/rewindBridge.ts`.

## Comments

**2026-08-17.** The coordinator entry already accepted `checkpointBubbleId`, but
no UI passed one, so the fork always used the last user bubble and steps were
not selectable. Added `listReplaySafeCheckpoints` (one admissibility rule, now
shared with `threadStore.forkThreadFromCheckpoint`) and a `ForkFromCheckpoint`
picker rendered in `ExecutionPage` and `RecordsPage`. A non-replay-safe id is
refused with its reason rather than adjusted.

`smoke:coordinator` gained a fork scenario asserting the forked run archives
exactly once, releases its slot, lands on a new thread, and leaves the parent
thread's bubbles untouched.
