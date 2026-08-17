# 08 — Promote external CLI runners to the subagent contract

**What to build:** Route external CLI execution through the `hermes/delegate.ts` contract and implement at least the `continueGoal` prompt contract, so `executionKind: 'external'` can take part in goal-based loops.

**Blocked by:** None.

**Status:** 可交給代理

A user who selects a CLI provider silently gets a different product. `CLAUDE.md` states that `executionKind: 'external'` has run-scoped progress only, with no Parse, no DoD, no iteration, and no `continueGoal`, and that a CLI must not present as DoD met. Three and a half of the four loop patterns stop working. The CLI provider is an executor, not a subagent.

The comparison's reference point is a harness that puts every driver behind one subagent contract — a child agent is a child agent regardless of transport. That is the shape to aim for here.

- [x] `agent/cliAdapters.ts` and `agent/localCliRun.ts` execute through the `agent/hermes/delegate.ts` contract rather than a parallel path.
- [x] The `continueGoal` prompt contract is implemented for external runners, so goal-based iteration produces real continuation rather than a single run.
- [x] DoD evaluation for external runners is honest: a CLI still never presents as DoD met on the strength of exit status alone.
- [x] `DelegationBudget` depth and concurrency caps apply to external runners as they do to in-process delegates.
- [x] Leaf isolation holds — an external leaf receives `blockedTools` and no parent transcript.
- [x] Unattended external runs still auto-deny HITL and safety interventions after the timeout rather than blocking.
- [x] External runs settle through the coordinator's single finalization path.
- [x] `npm run smoke:loop-parity` proves external and builtin runners behave identically on `continueGoal`.
- [x] The `CLAUDE.md` paragraph describing external as run-scoped-only is updated to match the delivered behaviour.

Files: `app/src/agent/cliAdapters.ts`, `app/src/agent/localCliRun.ts`, `app/src/agent/hermes/delegate.ts`, `app/src/agent/runners/`, `CLAUDE.md`.

## Comments

**2026-08-17.** `continueGoal: true` is earned by the prompt contract in
`runners/types.ts`, consumed in `runDispatch.ts`. The contract-building logic
was extracted out of an inline ternary into `buildCliContinueGoalContract` so
parity is provable rather than asserted: `smoke:loop-parity` now checks that the
external CLI contract is derived field-by-field from the same `continueGoal`
resume override the builtin runner restores from, that every missing gap reaches
the prompt, and that `codex` still declares `validateDoD: false` / `iterate:
false`. `CLAUDE.md`'s "run-scoped progress only" paragraph was corrected.
