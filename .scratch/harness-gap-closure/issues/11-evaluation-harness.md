# 11 — Build a repeatable evaluation harness

**What to build:** Run a fixed batch of tasks through the headless entry and produce a comparable summary from `runJournal` and `artifactIndex` output.

**Blocked by:** 10 — Add a headless run entry for development and evaluation.

**Status:** 可交給代理

Neither this project nor the harness it was compared against has a real benchmark — the `dsh` `BENCHMARK.md` is two sentences pointing at a Python SDK. This is open ground on both sides, and it becomes reachable as soon as ticket 10 lands.

Aim for repeatability first and metric design second. A harness that reruns the same batch and produces a diffable summary is worth more than a scoring model nobody trusts yet.

- [ ] A fixed task set is defined as data in the repository, not embedded in the runner.
- [ ] The batch runs through the ticket 10 headless entry using the coordinator, not a bypass path.
- [ ] Each task produces a summary derived from existing `agent/runJournal.ts` and artifact index output; no new telemetry is collected.
- [ ] The summary is deterministic in structure so two runs can be diffed, with model non-determinism isolated to clearly marked fields.
- [ ] A rerun of an unchanged batch against an unchanged build produces a structurally identical summary.
- [ ] Failures, timeouts, and auto-denied interventions are recorded as outcomes rather than dropped.
- [ ] The harness is not wired into `npm run smoke` or `smoke:ci` — it is an evaluation tool, not a gate.
- [ ] Metric design is explicitly deferred and recorded as an open question in the summary output.

Files: new evaluation runner under `app/scripts/`, `app/src/agent/runJournal.ts`, artifact index module.
