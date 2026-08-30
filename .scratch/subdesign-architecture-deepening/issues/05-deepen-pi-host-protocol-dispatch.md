# 05 — Deepen Pi Host Protocol dispatch

Status: resolved

## Comments

- 2026-08-30 resolved：`sessions/*`、`runs/*`、`tools/*` 與 `approvals/*` 已由各自 deletion-test domain module 單一路由；catalog／contract／approval policy 移入 tool domain，queue 與 session mutations 移入 owning domains。Protocol router 保留版本與 capability validation、domain selection、normalized response，以及唯一 cursor-based commit；source guard 明確禁止主 dispatcher 重新長回這四組 method branches。`npm run build`、touched-file oxlint、完整 `smoke:pi-host` 與完整 `npm run smoke` 均 exit 0。
- 2026-08-28 staged safely, not yet resolved: capability、resources、extensions 已各自移入 deletion-test domain module；server persistence 改由 cursor-based `PiHostDispatchOutcome.commit` 決定並刪除 method-prefix heuristic。Sessions/runs/tools 尚未完成 domain extraction，因此本票保持 open。

## Implementation Progress

- [x] Canonical persistence uses the explicit cursor-based dispatch commit outcome.
- [x] Capability activation owns a deletion-test domain module.
- [x] Resource discovery and reload own a deletion-test domain module.
- [x] Extension lifecycle owns a deletion-test domain module.
- [x] Session create/fork/reset/compact/list/record behavior owns one session domain.
- [x] Run queue and attachment routing own one run domain.
- [x] Tool catalog/contract/execution routing and approvals own one tool domain.
- [x] The production-owner guard rejects duplicate session/run/tool/approval branches in the main dispatcher.
- [x] Build, touched-file lint, full Pi Host smoke and full repository smoke pass.

Dependencies satisfied: 02, 03

## Parent

[Deepen the OpenDesign → SubDesign architecture](../spec.md)

## Problem Statement

Renderer、Electron main and Pi Core Host already communicate through one versioned, capability-negotiated Pi Host Protocol, but the Host request dispatcher still implements many domains in one large conditional function: initialization、sessions、Task runs、turns、tools、approvals、settings、resources、memory、extensions、orchestration、queue recovery and SubDesign provider execution. State persistence and event commit behavior are also inferred in more than one place.

Users depend on this path for canonical conversation and execution state, so unrelated edits in a giant dispatcher carry broad regression risk. Maintainers cannot change one protocol domain with strong locality, and tests sometimes rely on dispatcher source shape instead of treating the external protocol as the shared caller/test interface. Adding more internal pass-through modules would not help unless each module absorbs a complete Host capability and central commit semantics.

## Solution

Preserve the existing versioned Pi Host Protocol as the only external interface. Internally deepen dispatch into domain modules that each own a coherent Host capability while a small protocol router performs version/capability validation, domain selection and normalized response/event handling. Centralize canonical state mutation and event commit behavior so it is driven by explicit domain results rather than duplicated method-prefix knowledge.

No new renderer IPC protocol is introduced. Pi Core Host remains the production owner of sessions, runs, tool execution, approvals and settlement. The work is staged after provider and streaming ownership stabilize, allowing SubDesign pipeline dispatch to enter as one coherent domain rather than provider-specific branches.

## User Stories

1. As a desktop user, I want existing Pi Host features to behave identically after internal refactoring, so that architecture work is transparent.
2. As a desktop user, I want Host restart and renderer reload to preserve canonical sessions and run state, so that recovery remains reliable.
3. As a desktop user, I want protocol incompatibility reported explicitly, so that the app never guesses behavior across versions.
4. As a desktop user, I want unsupported capabilities rejected or hidden consistently, so that a client cannot call unavailable Host behavior.
5. As an operator, I want queued and active run settlement committed exactly once, so that recovery cannot duplicate effects.
6. As a security-conscious user, I want approvals, tools, credentials and settings remain Host-owned, so that internal modularization does not expose authority to renderer.
7. As a maintainer, I want one external protocol interface, so that renderer and Host do not drift into multiple contracts.
8. As a maintainer, I want each request domain to have locality, so that a settings change does not require understanding run queue or tool execution implementation.
9. As a maintainer, I want canonical state/event commit rules centralized, so that persistence does not depend on method-name heuristics in multiple modules.
10. As a maintainer, I want domain modules to return explicit outcomes, so that routing, persistence and event emission are testable without hidden side effects.
11. As a contributor, I want adding a Host method to touch its protocol declaration and owning domain module, so that unrelated domains remain stable.
12. As a contributor, I want SubDesign provider execution represented as one pipeline domain, so that protocol dispatch does not know concrete adapters.
13. As a reviewer, I want every internal domain module to pass the deletion test, so that removing it deletes a full Host capability rather than a forwarding function.
14. As a reviewer, I want no Pi implementation class exposed as a desktop contract, so that ADR-0038 remains intact.
15. As a QA engineer, I want domain behavior exercised through real protocol requests, so that internal code motion does not weaken compatibility coverage.
16. As a QA engineer, I want state-changing and read-only methods distinguished by explicit outcomes, so that recovery persistence is deterministic.
17. As an AI coding agent, I want protocol domains concentrated, so that a Host change requires less traversal and carries a smaller blast radius.

## Implementation Decisions

- The versioned, capability-negotiated Pi Host Protocol remains the sole external interface between renderer, Electron main and Pi Core Host.
- Protocol request and event schemas remain product-owned and do not expose Pi Core implementation classes.
- A small router owns initialization/version checks, capability checks, request validation, domain selection and normalized protocol error handling.
- Internal domain modules own coherent capabilities such as sessions, runs/orchestration, tools/approvals, settings, resources/extensions/memory and SubDesign pipeline execution.
- Domain grouping follows actual behavior and state ownership, not arbitrary file size targets.
- Each domain module returns explicit outcome metadata sufficient for centralized state persistence and event commit decisions.
- Canonical state mutation, journal persistence and cursor/event publication are centralized rather than inferred by duplicated method-prefix checks.
- Read-only requests cannot accidentally trigger state persistence; state-changing requests cannot finish without the required commit path.
- The provider module from issue 02 appears to dispatch as one Host pipeline capability, with concrete adapters hidden behind its internal seam.
- The streaming projection contract from issue 03 remains a versioned Host event/snapshot concern; renderer derivation does not move into Host.
- Pi Settings remain runtime source of truth under ADR-0025.
- Pi Host state and run journal remain canonical under ADR-0039.
- Pi Core Host retains tool loop, approvals, execution and settlement ownership under ADR-0045.
- Existing external method names and capability negotiation remain compatible unless a required change is introduced through an explicit protocol version decision.
- The migration is replace-don't-layer: temporary routing compatibility names a deletion gate and does not become a permanent dual dispatcher.
- Broad code movement is staged by domain with the full protocol test seam green after each slice.

## Testing Decisions

- The primary and ideal single seam is the existing versioned Pi Host Protocol interface.
- A good test sends protocol requests and observes responses, events, snapshots and durable state; it does not call internal domain modules to prove user-visible behavior.
- Initialization coverage proves version mismatch, missing capability and valid negotiation behavior remain explicit.
- One request matrix covers representative read-only and state-changing methods from every domain.
- A state-commit case proves explicit domain outcomes trigger exactly one canonical persistence/event commit.
- A read-only case proves queries do not mutate journal or cursor state.
- A restart case proves sessions, queued runs and interrupted-run settlement recover through existing snapshot/cursor behavior.
- A Task run case proves admission, orchestration, tool events, approvals, cancellation and settlement remain Host-owned.
- A settings case proves runtime reads and updates continue through Pi Settings authority without a renderer duplicate.
- A SubDesign pipeline case proves protocol dispatch invokes one provider-stage interface and publishes normalized stage/stream events.
- An archived-session case proves renderer projection cannot resurrect a Host tombstone.
- An error case proves invalid request, unavailable capability and domain failure map to stable protocol errors without leaking implementation details.
- A compatibility case proves current renderer/preload callers work unchanged through the refactor.
- Prior art includes Pi Host protocol, settings, sessions, queue, recovery, orchestration, tools, memory, resource, extension and OpenDesign pipeline smokes.
- Focused internal tests may verify pure domain invariants, but they cannot replace protocol-level behavior tests.
- Source drift guards may be repointed at the new owner after the protocol behavior is covered; they are not weakened or mirrored.
- Verification includes build/typecheck, lint for touched sources and the complete smoke chain after every staged domain move.

## Out of Scope

- A new Pi Host Protocol version without a separate compatibility decision.
- A second renderer IPC contract or direct renderer access to Pi Core classes.
- Replacing Pi Core Host with the Pi CLI/TUI or an external process contract.
- Changing Task run coordinator admission, concurrency or automation semantics.
- Changing Approval Mode or Outbound Data Gate policy.
- Moving renderer UI Projection into Host.
- Adding new Host capabilities unrelated to dispatch deepening.
- Rewriting every Electron main handler outside the Pi Host Protocol.
- Removing compatibility seams before parity and deletion gates are met.

## Further Notes

- This is the highest-blast-radius ticket and intentionally runs after issues 02 and 03.
- Implementation should proceed one protocol domain at a time while preserving the same external interface and full smoke coverage.
- Completion requires the main dispatcher and commit ownership to become materially smaller. Merely splitting branches into pass-through functions fails the deletion test.
