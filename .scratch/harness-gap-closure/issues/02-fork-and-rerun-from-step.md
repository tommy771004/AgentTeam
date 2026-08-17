# 02 — Fork a run and rerun from step N

**What to build:** Give the user an action that forks a recorded run at a chosen step, lets them adjust, and reruns from there through the normal coordinator ingress.

**Blocked by:** None.

**Status:** 可交給代理

This is the highest-frequency action for an agent product and the product has no entry point for it, even though all the data exists. `agent/runJournal.ts`, `electron/rewindBridge.ts`, and `agent/compactionCheckpoint.ts` already hold what is needed, and ADR-0042 already decided that retries start only from a replay-safe checkpoint. The user-facing side is split across four separate pages — `LogsPage`, `RecordsPage`, `ArchivePage`, `FailedPage` — none of which offers "fork from step N". `sessionSearch.ts` exists but serves the agent, not the user.

- [ ] A run's recorded steps are selectable, and forking from a selected step is a visible action in `ExecutionPage` and `RecordsPage`.
- [ ] The fork point is constrained to a replay-safe checkpoint, per ADR-0042; non-replay-safe points are refused with a stated reason rather than silently adjusted.
- [ ] The forked rerun enters through `agent/taskRunCoordinator.ts` `runTask` with an explicit `sourceKind` and truncated history. Nothing calls `dispatchThreadTask` or `startExecution`.
- [ ] The forked run obeys the same capacity, busy-policy, queue, and dedupe rules as any other run.
- [ ] Finalization for a forked run happens exactly once and in the fixed order (summary → afterRun → Archive → onSettled → release → drain).
- [ ] The original run's record is preserved; a fork does not overwrite or mutate its parent.
- [ ] `npm run smoke:coordinator` asserts single, correctly ordered finalization for a forked run.

Files: `app/src/pages/ExecutionPage.tsx`, `app/src/pages/RecordsPage.tsx`, `app/src/agent/taskRunCoordinator.ts`, `app/src/agent/runJournal.ts`, `app/src/agent/compactionCheckpoint.ts`, `app/electron/rewindBridge.ts`.
