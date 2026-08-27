# Verified Working Memory lifecycle qualification

Status: `resolved`  
Qualified: 2026-08-28 (Asia/Taipei)

## One-command evidence

From `app/`:

```sh
npm run smoke:verified-memory-lifecycle
```

The command builds the shipped Pi Host bundle, then runs
`scripts/smoke-verified-memory-lifecycle-qualification.mts`. That single
qualification workflow executes the production seams for:

1. multi-goal Working State, accepted and rejected Checkers, compaction,
   persisted checkpoint, Host restart, resume, and final settlement;
2. Skill interception, immutable Skill revision injection, fresh-call redraft,
   and the parallel batch barrier before side effects;
3. parallel delegated-goal execution where only the parent Host Checker commits
   parent state;
4. bounded Meta-Agent diagnosis and inactive component-local candidates;
5. canonical `runHeadlessTask -> taskRunCoordinator.runTask -> Pi Host`
   baseline/candidate evaluation, source-failure repair, held-out anchors,
   regression rejection, and atomic promotion;
6. frozen builtin/external/plain-browser runner guarantees and Turn Record
   restart/reload/paging fidelity.

The Skill-redraft workflow asserts from one Turn Record that the initial goal
was pending, which Memory-Control Package governed the run, which immutable
Skill was selected, that the intercepted call did not execute, which fresh tool
effect succeeded, which receipt the Checker accepted, and that Working State
advanced from revision 1 to revision 2.

The evaluation workflow additionally holds an audit run open across atomic
promotion: that admitted run remains on package revision 1, while the first new
run after settlement observes the promoted candidate revision. Rejected
candidates never change the active revision.

## Ownership and drift evidence

The qualification fails if any of these boundaries drift:

- a production owner outside Pi Host calls `recordTurnEntry` or creates a second
  Working State authority;
- model or child output writes Host `state-check`/`working-state` entries;
- `src/agent/loop/` returns as a production compatibility owner;
- Memory-Control code imports or takes ownership of durable-memory SQLite,
  CRUD, import/export, Learning, or Settings surfaces;
- any lifecycle smoke is no longer reachable from the production `npm run
  smoke` graph.

The durable-memory migration remains independently qualified by
`smoke-durable-memory-workflow-qualification.mts`; this effort neither changes
its SQLite schema nor implements a parallel store.

## Final gates

- `npm run build`
- `npx oxlint src electron`
- `npm run smoke:verified-memory-lifecycle`
- `npm run smoke`

All four must be green before this evidence and ticket 15 may remain resolved.
