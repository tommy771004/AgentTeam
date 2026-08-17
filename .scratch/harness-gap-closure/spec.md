# Close the harness gaps and productise the governance advantages

Status: 可交給代理

Source: `docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md` (analysis of `deepseek-ai/deepseek-harness` against `app/src/agent/**`, `app/electron/**`, `CONTEXT.md`, `docs/adr/`, dated 2026-08-17).

## Problem Statement

A source-level comparison against the DeepSeek harness (`dsh`) found that SubAgents AI is behind on framework composability and ahead on product governance, and that neither position is currently expressed in the product.

Three classes of problem follow from that.

**Broken paths.** Six workflows break when a user tries to walk them end to end. The Pi migration runs on two tracks at once — `CLAUDE.md` describes the legacy `agent/loop` + `agent/engine.ts` architecture while `CONTEXT.md` describes Pi Core as the sole tool-loop owner — and the same feature has two execution paths with different semantics (`bash` under browser fallback versus Pi Host). After a failed run there is no way to return to step N, change something, and rerun, even though `runJournal.ts`, `rewindBridge.ts`, and `compactionCheckpoint.ts` already hold the data. External CLI providers are second-class: `executionKind: 'external'` has run-scoped progress only, so three and a half of the four loop patterns silently degrade. Progressive disclosure persists `lastCapabilityIds` / `lastUnlockedTools` on the thread but shows the user nothing and offers no way to lock capabilities back. The learning loop drafts skills and memory into localStorage with no path to a file, so nothing can be committed or shared. Configuration is a flat `LlmSettings` object plus localStorage, so a configured agent cannot be handed to a colleague.

**Missing capability.** There is no `grep`, no `glob`, and no LSP — the highest-frequency tool family for a coding agent. `supervisor.ts` truncates oversized tool output instead of spilling it to a retrievable locator. There is no headless entry point, so the coordinator cannot be exercised or evaluated outside a renderer, and no evaluation harness exists.

**Untrusted tests.** `scripts/smoke.mjs` states in its own header that it contains "Minimal re-implementations mirrored from source for CI without TS build". It inlines `computeNextRun`, supervisor truncation, and loop classification rather than importing them, so those checks validate an algorithm's shape and not the shipped code path. They are false green lights. `smoke-caps.mjs` does not have this problem — it imports real modules and carries architectural drift guards that `dsh` has no equivalent to.

Against that, the comparison identified seven structural advantages that `dsh` does not have and, given its positioning as a general framework, will not build: the task lifecycle governance layer (`taskRunCoordinator.runTask` as sole ingress, eight `sourceKind`s, busy policy, bounded queue, capped concurrency, unique finalization, and the crash-recovery journal of ADR-0040); type-level fail-closed trigger evidence (`LoopRequest`'s `'time'` / `'proactive'` variants are unrepresentable without a `ScheduleTriggerSnapshot` / `EventTriggerSnapshot`, where `dsh` exposes `schedule_create` as a model-callable tool); versioned and re-approvable permission surfaces (`toolPackage.ts` `operationClass`, `modelProfile.ts` provenance, `secretsVault.ts`, restrict-only `hooks.ts`, `entitlement.ts` failing closed to `free`); an entire outbound/DLP subsystem of 21 modules backed by ADR-0004 through ADR-0022 that `dsh` has no counterpart to; vertical workflow tools; the desktop product form with signed updates and OS credential storage; and the Pi Core bet itself, which converges the provider-breadth gap as a side effect.

Every one of those advantages is currently backend policy with no user-facing surface. They cannot be demonstrated, audited, or sold.

## Solution

Close the broken paths and the missing capabilities using the mechanisms that already exist, and give each governance advantage a user-facing surface, an exportable artifact, or a written principle.

Declare one architecture. `CLAUDE.md` and `CONTEXT.md` describe the same runtime, with the legacy loop marked as an explicitly time-bounded transitional path, and a drift guard prevents new references to `agent/loop/*` from accumulating. This shortens the dual-track period rather than managing it.

Turn existing data into user actions. Fork-and-rerun-from-step-N reuses the journal, the rewind bridge, and replay-safe checkpoints, and routes through `taskRunCoordinator.runTask` so the single-finalization invariant holds for forked runs. Capability state already held in `capabilities/runtime.ts` becomes a thread-sidebar list with a reset control. Drafted skills gain a write path to `<project>/.subagents/skills/<name>/SKILL.md` using the existing project-root resolution in `electron/projectBridge.ts`.

Add the missing tools through the current registration model, not the one `CLAUDE.md` documents. `tools/executor.ts` is a fifteen-line compat shim and the central `executeTool` switch was deliberately deleted; new tools declare themselves in `tools/toolDefinitions.ts` with an `owningCapability` and self-register from `tools/registered/*.ts`. `registry.ts` and `schemas.ts` are derived views. The stale four-file contract in `CLAUDE.md` is corrected as part of the same work.

Make the tests real. `smoke.mjs` imports the modules it claims to cover, proven by breaking `computeNextRun` and confirming the pre-change suite still passes while the post-change suite fails.

Productise governance. The scheduler, events, and execution pages merge into one Ops console that answers what is running, what is queued, what was deduplicated, why something was queued, how much concurrency remains, and which runs were recovered after a crash. Outbound gains a per-run view of what was sent, what was redacted, and to which provider. Permission fingerprints and egress evidence combine into one exportable compliance report. The unforgeable-evidence property is written as an ADR in its own right and extended to every side-effect exit, so `message_send`, content publishing, and paid-workflow merge/push/deploy each require a non-model-generated evidence snapshot. `paidWorkflow.ts`'s `ArtifactEvidence` stops being internal state and becomes a per-stage deliverable the user can inspect and reject.

Two changes are scope decisions rather than implementation, and each needs an ADR before code. Extending the ADR-0022 filesystem-sandbox obligation from external CLI to the builtin shell changes what `required` mode means and needs Windows fallback semantics defined. Stating that a model may never manufacture its own execution credential generalises a property ADR-0026 currently only secures for loop patterns.

Do not compete with `dsh` on framework composability. The positioning is a Chinese-language agent workstation for teams, and the Pi Core migration supplies the extension points that `dsh` gets from Cordis.

## User Stories

1. As a contributor, I want `CLAUDE.md` and `CONTEXT.md` to describe one runtime, so that I do not implement against the wrong architecture.
2. As a contributor, I want new references to the legacy loop to fail a guard, so that the dual-track period shrinks instead of growing.
3. As a user whose run failed at step N, I want to fork from that step, adjust, and rerun, so that I do not restart the whole task.
4. As a user, I want a forked rerun to obey the same queue, concurrency, and finalization rules as any other run, so that forking cannot corrupt lifecycle state.
5. As a user, I want to see which capabilities and tools a thread currently has unlocked, so that I can diagnose unexpected model behaviour.
6. As a user, I want to reset a thread's unlocked capabilities, so that a mistaken unlock is recoverable without discarding the thread.
7. As a user, I want drafted skills and memory written into my project as files, so that I can review, commit, and share them.
8. As a maintainer, I want the skill write path confined to the resolved project root, so that generated files cannot escape the workspace.
9. As a maintainer, I want smoke checks to import the shipped modules, so that a green suite means the shipped code is correct.
10. As a maintainer, I want a deliberately broken `computeNextRun` to fail the suite, so that coverage claims are falsifiable.
11. As a user, I want the agent to search my project by pattern and by glob, so that it can navigate code the way a coding agent is expected to.
12. As a maintainer, I want any bundled search binary invoked with configuration injection blocked, so that a user's environment cannot alter search behaviour.
13. As a user, I want oversized tool output stored and referenced by locator rather than truncated, so that neither the information nor my token budget is wasted.
14. As a user running an external CLI provider, I want goal-based iteration to work, so that choosing a CLI does not silently downgrade the product.
15. As a maintainer, I want external and builtin runners proven equivalent on `continueGoal`, so that parity is demonstrated rather than asserted.
16. As a security-conscious user, I want to know whether the builtin shell is isolated or refused under `required` mode, so that the strictest mode is both honest and usable.
17. As a maintainer, I want the builtin-shell sandbox scope change justified in an ADR before code, so that a governance obligation is not widened by implementation drift.
18. As a maintainer, I want the coordinator callable from plain Node, so that core behaviour can be exercised and evaluated without a renderer.
19. As a maintainer, I want the headless entry to remain a development and evaluation seam, so that it does not become a second product contradicting ADR-0046.
20. As a maintainer, I want a repeatable batch of fixed tasks scored from journal and artifact output, so that changes can be compared over time.
21. As an operator, I want one console showing queue depth, active runs, deduplicated work, queue reasons, remaining concurrency, and crash-recovered runs, so that multi-source automation is observable.
22. As an operator, I want to know why a specific run was queued or dropped, so that automation behaviour is explainable after the fact.
23. As a maintainer, I want the principle that a model cannot manufacture its own execution credential written as an ADR, so that it can be cited externally.
24. As a security-conscious user, I want every side-effect exit to require non-model-generated evidence, so that message sending, publishing, and deployment inherit the same guarantee as scheduling.
25. As a user, I want to see what a run sent outbound, what was redacted, and to which provider, so that data-egress policy is visible rather than implied.
26. As a compliance reviewer, I want one exportable report covering who was authorised to run what, which credentials were used, which files changed, and which tools were blocked by a fingerprint change, so that an audit is a document rather than an investigation.
27. As a paid-workflow user, I want each stage to produce an inspectable artifact I can reject, so that the value is the deliverable and not the state machine.

## Implementation Decisions

- The comparison document is analysis input. Nothing in it is authoritative over `CONTEXT.md`, `docs/adr/`, or the source; where they disagree, the source wins and the ticket records the correction.
- New tools follow the current self-registration model: a definition in `agent/tools/toolDefinitions.ts` carrying `owningCapability`, and a self-registering handler under `agent/tools/registered/*.ts`. `registry.ts` and `schemas.ts` are derived views and are not hand-edited. `executor.ts` is a compat shim and gains no switch cases.
- The stale "Adding a tool touches `registry.ts` / `schemas.ts` / `executor.ts` / `builtins.ts`" instruction in `CLAUDE.md` is corrected in the same change that first relies on the current model.
- All new run entry points, including forked reruns and any headless entry, call `agent/taskRunCoordinator.ts` `runTask` with an explicit `sourceKind`. Nothing calls `dispatchThreadTask` or `startExecution` directly.
- Fork-and-rerun sources truncated history from a replay-safe checkpoint per ADR-0042 and does not replay effectful work without replay-safety proof.
- Capability inspection and reset read and clear the state already held in `agent/capabilities/runtime.ts` and mirrored on the thread as `lastCapabilityIds` / `lastUnlockedTools`. No new persistence layer is introduced.
- Skill and memory file output resolves the project root through `electron/projectBridge.ts` and writes under `<project>/.subagents/`. Path resolution is not reimplemented.
- `scripts/smoke.mjs` imports real modules using the `.mts` plus `--experimental-strip-types` pattern already proven by `smoke-caps.mjs` and the `smoke-*.mts` scripts. Inline mirrors are deleted, not left alongside.
- Large tool output spills to `electron/attachmentStore.ts` and returns a locator plus retrieval instructions. `agent/supervisor.ts` keeps its byte limits and round budgets; only the disposal of over-limit payloads changes.
- External CLI runners reach goal-based iteration through the `agent/hermes/delegate.ts` contract rather than a parallel mechanism, and at minimum implement the `continueGoal` prompt contract.
- Extending the filesystem-sandbox obligation to the builtin shell requires a revised or new ADR before implementation. It is a scope decision on ADR-0022, not a bug fix. The ADR must define Windows fallback semantics, since no backend exists there.
- The hardcoded `shellIsolationVerified: false` call site is `src/agent/tools/registered/bash.ts:60`; `agent/outbound/cliSandbox.ts` declares and consumes the flag. The comparison document attributes the call site to `cliSandbox.ts` and is wrong on that detail.
- The unforgeable-evidence principle is written as a standalone ADR and then extended to side-effect exits. ADR-0026 preserves loop patterns but does not state evidence unforgeability as an independent principle.
- ADR numbers are assigned at authoring time against the free range; `docs/adr/` currently ends at `0046`.
- The headless entry is a development and evaluation seam only, consistent with ADR-0046. It reuses the `agent/llm.ts` `setLlmTransport` seam and must not pull renderer-only modules into the Node path.
- The Ops console consolidates `SchedulerPage`, `EventsPage`, and `ExecutionPage` into one surface reading existing coordinator, queue, concurrency, and journal state. It does not add new lifecycle behaviour.
- The compliance report composes existing output from `security:gates`, `release:qualification`, the smoke evidence ledger, `agent/outbound/evidenceLedger.ts`, and `tools/toolPackage.ts` fingerprints into one exportable document. Nothing new is collected.
- The outbound run view is a projection of metadata already recorded at the gate. It never surfaces raw credentials, and the renderer never gains a path that reads them.
- All work is incremental. New and old paths coexist only behind a seam that names its deletion gate, per ADR-0045.

## Testing Decisions

- Verification uses the existing pipeline and adds no test framework: `npm run build` as typecheck, `npx oxlint src`, `npm run smoke`, `npm run smoke:ci`.
- The legacy-loop drift guard is verified negatively: deliberately adding one `agent/loop/*` reference must fail `npm run smoke`.
- The `smoke.mjs` rewrite is verified by falsification: deliberately breaking `computeNextRun` must pass the pre-change suite and fail the post-change suite. The same falsification applies to supervisor truncation, `classifyLoopType`, and `eventMatcher`.
- Fork-and-rerun is verified through `npm run smoke:coordinator`, asserting that a forked run still passes through the single finalization path in the fixed order.
- Skill file output is verified by a new smoke asserting the written path resolves under the project root and cannot escape it, following the path assertions in `smoke-sanitized-workspace.mts`.
- New tools are verified by `npm run smoke:tool-registry` for orphan detection, `smoke-tool-invocation.mts` for invocation, and the existing `smoke-caps.mjs` guard requiring every registry tool to be read-only or classified.
- Spill is verified by supervisor logic smoke plus a large-output case confirming a locator is returned and the payload is retrievable.
- External CLI parity is verified by `npm run smoke:loop-parity` proving external and builtin runners behave identically on `continueGoal`.
- Builtin-shell sandboxing, if the ADR approves it, follows the real-probe pattern of `smoke-cli-sandbox`, `smoke-cli-main-sandbox`, and `smoke-cli-filesystem-sandbox.mts`. `smoke:outbound-shell-evidence` must show builtin `bash` under `required` as isolated execution rather than refusal.
- The headless entry is verified by a smoke completing one turn-based run in Node, plus `npm run smoke:prod` confirming no renderer-only module entered the Node path.
- Evidence-requirement extension is verified by asserting each side-effect exit refuses a request carrying model-generated evidence and accepts only an adapter-produced snapshot.
- The compliance report and outbound run view are verified by asserting the exported document contains the expected authorisation, credential-reference, file-change, and blocked-tool entries, and contains no raw secret material.
- UI surfaces are confirmed manually under `npm run dev` where no protocol-observable assertion exists, and are not counted as behaviour coverage.

## Out of Scope

- Rebuilding the runtime as a plugin kernel or matching `dsh` on framework composability.
- Replacing the React desktop UI with a plugin-composed UI shell.
- Adopting vitest or any additional assertion framework, coverage tooling, or perf/stress suites.
- Shipping headless or SDK distribution as a second product form, which ADR-0046 excludes.
- Building an ACP server, a TypeScript or Python SDK, or any external protocol surface.
- Adding native Anthropic, Gemini, or Bedrock providers directly to `agent/apiProviders.ts`; provider breadth converges through the Pi Core migration.
- Driving Claude Code or Codex as subagent providers.
- Adding an LSP integration, persistent real PTY backends, remote sandbox execution, or a self-referential runtime-mutation toolset.
- Reading Claude Code or Codex hook files in place of the repository's own `hooks.ts` format.
- Rewriting `smoke-caps.mjs`, which already imports real modules and carries the drift guards.
- Changing the builtin-shell sandbox scope before its ADR is accepted.
- Institutionalising a three-file i18n system for documentation.

## Further Notes

- The comparison document itself is the analysis of record and should be linked from any ADR this effort produces.
- `agent/llmResilience.ts` is ahead of the `dsh` equivalent and needs no work here.
- `smoke-caps.mjs` architectural drift guards have no `dsh` counterpart and are the pattern new guards should follow.
- The dual-track cost grows linearly with time; ticket 01 should be taken first because it determines where subsequent code belongs.
- Work the dependency frontier one unblocked ticket at a time, per `docs/agents/issue-tracker.md`.
