# 11 — Build a repeatable evaluation harness

**What to build:** Run a fixed batch of tasks through the headless entry and produce a comparable summary from `runJournal` and `artifactIndex` output.

**Blocked by:** 10 — Add a headless run entry for development and evaluation.

**Status:** resolved

Neither this project nor the harness it was compared against has a real benchmark — the `dsh` `BENCHMARK.md` is two sentences pointing at a Python SDK. This is open ground on both sides, and it becomes reachable as soon as ticket 10 lands.

Aim for repeatability first and metric design second. A harness that reruns the same batch and produces a diffable summary is worth more than a scoring model nobody trusts yet.

- [x] A fixed task set is defined as data in the repository, not embedded in the runner.
- [x] The batch runs through the ticket 10 headless entry using the coordinator, not a bypass path.
- [x] Each task produces a summary derived from existing `agent/runJournal.ts` and artifact index output; no new telemetry is collected.
- [x] The summary is deterministic in structure so two runs can be diffed, with model non-determinism isolated to explicit task output fields.
- [x] A rerun of an unchanged batch against an unchanged build produces a structurally identical summary.
- [x] Failures, timeouts, and auto-denied interventions are recorded as outcomes rather than dropped.
- [x] The harness remains a development/evaluation tool rather than a product surface. A later repository decision intentionally added its deterministic smoke to the gap-closure gate.
- [x] The original metric deferral was superseded by the later memory-control evaluation gate; current scoring is derived from existing status/artifact evidence and adds no telemetry.

Files: `app/evaluation/tasks.json`, `app/src/agent/evaluationHarness.ts`, `app/scripts/evaluation-runner.mts`, `app/scripts/smoke-evaluation.mts`.

## Resolution evidence (2026-08-31)

`runEvaluationBatch` executes the repository task data sequentially through `runHeadlessTask`, then projects `runJournal`, artifact indexes, recovery reports and Turn Records from caller-owned in-memory storage. `smoke-evaluation.mts` verifies all fixed tasks retain run-linked journal outcomes; the later canonical memory evaluation gate owns metric semantics.
