# 02 — Deepen the Host provider adapter module

Status: 可交給代理

Blocked by: None

## Parent

[Deepen the OpenDesign → SubDesign architecture](../spec.md)

## Problem Statement

SubDesign provider execution already enters through one Host-owned interface, but its implementation still selects Storybook、Chrome DevTools、Harness 與 fake provider through explicit branching and then inspects provider-specific result fields. Validation、active-run state、timeout、progress、streaming、late cancellation、Execution evidence acceptance、attachments、artifact persistence and terminal projection coexist in one large function.

For users, this creates a risk that providers disagree on cancellation, blocked state, evidence persistence or activity. For maintainers, adding a fifth real adapter requires changing the common lifecycle implementation. The seam is real because four adapters already vary, but the current adapter roles do not hide enough provider detail to deliver locality or leverage.

## Solution

Deepen the Host provider adapter module while retaining the existing `executeSubDesignProviderStage` interface as the highest production and test seam. Each concrete adapter receives provider execution context and returns one normalized provider result. Common Host lifecycle implementation owns validation、selection、timeout/cancellation coordination、progress/stream events、trusted evidence checks、persistence and terminal projection exactly once.

Provider-specific configuration validation and response normalization stay inside the concrete adapter. Renderer code never selects adapters or issues trusted evidence. Unsupported providers fail closed through the same lifecycle rather than being admitted in one place and blocked by unrelated knowledge later.

## User Stories

1. As a SubDesign user, I want all providers to report queued, running and terminal states consistently, so that activity has one vocabulary.
2. As a SubDesign user, I want Stop to cancel the active provider regardless of provider kind, so that cancellation is predictable.
3. As a SubDesign user, I want a late provider completion ignored after cancellation, so that terminal state cannot be resurrected.
4. As a SubDesign user, I want provider timeout to become an explicit blocked or failed outcome according to policy, so that the run never hangs silently.
5. As a SubDesign user, I want evidence and attachments persisted consistently, so that Critique can trace every trusted observation.
6. As a designer, I want provider-specific context, findings and goal results preserved, so that normalization does not erase useful evidence.
7. As a security-conscious user, I want only Host-side trusted adapters to issue Execution evidence, so that model output cannot claim proof.
8. As a security-conscious user, I want invalid provider configuration rejected before external work begins, so that malformed requests fail closed.
9. As a maintainer, I want common lifecycle implementation independent of provider result fields, so that adding an adapter does not alter cancellation or persistence logic.
10. As a maintainer, I want one normalized adapter result, so that provider-specific response types end at the seam.
11. As a maintainer, I want availability knowledge owned by adapter selection, so that a provider is not admitted and rejected by conflicting lists.
12. As a maintainer, I want common evidence acceptance and path confinement applied to every adapter, so that security policy cannot drift.
13. As a contributor, I want a provider adapter to declare its identity, availability and execution behavior in one place, so that qualification is local.
14. As a contributor, I want progress reporting to use one Host callback shape, so that streaming events remain provider-independent.
15. As a reviewer, I want four real adapters to justify the seam, so that this refactor does not introduce hypothetical flexibility.
16. As a reviewer, I want the external provider-stage interface unchanged unless a proven invariant requires a versioned change, so that Pi Host callers remain stable.
17. As a QA engineer, I want every adapter exercised through common execution, so that lifecycle behavior is verified rather than inferred from adapter unit tests.
18. As an AI coding agent, I want provider-specific complexity concentrated in adapters, so that common lifecycle changes require fewer files.

## Implementation Decisions

- `executeSubDesignProviderStage` remains the single highest Host provider execution interface.
- Storybook, Chrome DevTools, Harness and fake provider are four concrete adapters at one earned internal seam.
- Every adapter returns a normalized provider result carrying receipt, trusted-evidence candidates and optional product-owned context/findings/goal/attachment projections.
- Provider-specific upstream types and configuration rules do not cross the adapter seam.
- Common implementation owns request parsing, manifest/snapshot/grant validation, active run registration, terminal-state rules, stream emission, evidence acceptance, persistence and final projection.
- Common implementation owns late-result cancellation checks through one reusable terminal path rather than copying cancelled projections.
- Adapters may report progress, but common implementation decides how progress becomes Host events and streaming updates.
- Timeout budget and output budget are common execution concerns; an adapter may enforce a stricter bounded limit when required by its upstream protocol.
- Adapter selection has one authoritative registry or equivalent selection point. Request admission and availability consume the same supported-provider knowledge.
- Unsupported or disabled adapters return a normalized fail-closed outcome without starting external work.
- Evidence remains adapter-issued and non-model. Common implementation applies the trusted-evidence acceptance rule before persistence.
- Artifact and attachment locators remain project-relative and pass Host path confinement.
- Renderer receives only projection events and cannot access the adapter seam.
- The refactor replaces the nested provider branch rather than retaining a legacy and registry path permanently.
- This work preserves Pi Core Host ownership under ADR-0045 and Execution evidence policy under ADR-0048.

## Testing Decisions

- The primary and preferred seam is the existing `executeSubDesignProviderStage` interface.
- A good test supplies a valid request and deterministic adapter behavior, then asserts emitted events, persisted projection and terminal result without reaching into adapter registry internals.
- One contract suite runs against all four adapter roles for success, blocked, timeout and targeted cancellation where the provider supports external work.
- A late-completion case proves cancellation remains terminal and no post-terminal content/file event is accepted.
- A validation case proves malformed manifest, stale snapshot, denied capability and missing required plugin input stop before adapter invocation.
- An availability case proves the authoritative supported-provider selection agrees with execution and no admitted-but-unavailable split remains.
- An evidence case proves model-attested evidence is rejected and trusted adapter evidence is persisted with run/stage/provider identity.
- An attachment case proves bounded attachments use safe project-relative locators and cannot escape the project.
- A stream case proves tool call, progress, tool result, file write and terminal events share monotonic sequence behavior across adapters.
- A provider-specific data case proves context/findings/goal results remain available through product-owned projection fields.
- A fake adapter case stays fully deterministic and serves as prior art for the highest-seam pipeline smoke.
- Prior art includes OpenDesign pipeline, provider, streaming and qualification smokes plus Host targeted-cancel and evidence guards.
- Adapter-local tests are permitted for upstream parsing or protocol edge cases, but they do not replace common lifecycle tests at the highest seam.
- Verification includes build/typecheck, lint for touched sources and the complete smoke chain.

## Out of Scope

- Adding a new provider or enabling MCP Apps execution.
- Moving provider execution into renderer code.
- Changing plugin manifest, snapshot or capability grant formats.
- Changing the meaning of Goal-based DoD or treating provider success as DoD met.
- Replacing the Pi Host Protocol.
- Broad changes to artifact rendering or UI Projection.
- Relaxing provider pinning, localhost restrictions, output budgets or path confinement.
- A second provider lifecycle retained for compatibility.

## Further Notes

- This issue may proceed independently from issue 01 because its implementation is Host-side.
- Completion requires common lifecycle code to stop inspecting concrete adapter result shapes. Merely moving the provider branch into another shallow function does not satisfy the deletion test.
- Issue 05 depends on this module so protocol dispatch can delegate one coherent provider domain instead of preserving provider-specific branches.
