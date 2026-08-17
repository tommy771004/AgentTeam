# 08 — Promote external CLI runners to the subagent contract

**What to build:** Route external CLI execution through the `hermes/delegate.ts` contract and implement at least the `continueGoal` prompt contract, so `executionKind: 'external'` can take part in goal-based loops.

**Blocked by:** None.

**Status:** 可交給代理

A user who selects a CLI provider silently gets a different product. `CLAUDE.md` states that `executionKind: 'external'` has run-scoped progress only, with no Parse, no DoD, no iteration, and no `continueGoal`, and that a CLI must not present as DoD met. Three and a half of the four loop patterns stop working. The CLI provider is an executor, not a subagent.

The comparison's reference point is a harness that puts every driver behind one subagent contract — a child agent is a child agent regardless of transport. That is the shape to aim for here.

- [ ] `agent/cliAdapters.ts` and `agent/localCliRun.ts` execute through the `agent/hermes/delegate.ts` contract rather than a parallel path.
- [ ] The `continueGoal` prompt contract is implemented for external runners, so goal-based iteration produces real continuation rather than a single run.
- [ ] DoD evaluation for external runners is honest: a CLI still never presents as DoD met on the strength of exit status alone.
- [ ] `DelegationBudget` depth and concurrency caps apply to external runners as they do to in-process delegates.
- [ ] Leaf isolation holds — an external leaf receives `blockedTools` and no parent transcript.
- [ ] Unattended external runs still auto-deny HITL and safety interventions after the timeout rather than blocking.
- [ ] External runs settle through the coordinator's single finalization path.
- [ ] `npm run smoke:loop-parity` proves external and builtin runners behave identically on `continueGoal`.
- [ ] The `CLAUDE.md` paragraph describing external as run-scoped-only is updated to match the delivered behaviour.

Files: `app/src/agent/cliAdapters.ts`, `app/src/agent/localCliRun.ts`, `app/src/agent/hermes/delegate.ts`, `app/src/agent/runners/`, `CLAUDE.md`.
