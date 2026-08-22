# Deepen the OpenDesign → SubDesign architecture

Status: 可交給代理

Source: 2026-08-22 architecture review of the recent OpenDesign → SubDesign execution and UI Projection hot spot.

## Problem Statement

SubDesign 與 OpenDesign 最近快速加入 Plugin Contract、provider integrations、streaming artifact、model discovery、content pack installation 與 qualification。使用者得到更多能力，但維護者修改一個概念時，仍常需要同時穿越 renderer page、Zustand stores、Pi Host Protocol、provider runtime、adapter、catalog 與 source-text smoke guards。

目前最高 churn 的 `SubDesignPage` 同時承擔 presentation、route/thread binding、project hydration、catalog lifecycle、model selection、raw Host event reconciliation 與三條 Task run 啟動流程。Host provider runtime 雖有良好的外部 interface，implementation 仍知道每個 adapter 的輸入差異與輸出欄位。Streaming reducer 已具備 depth，但 UI Projection 分散在 page、preview、activity 與 studio。OpenDesign pack installation 橫跨 catalog、local cache、project metadata、Electron filesystem enforcement、plugin registry 與 audit。Pi Host Protocol 對外已版本化，但內部 dispatcher 仍集中過多不相關 domain implementation。

這些問題降低 locality：一個 lifecycle 或 event 變更會散落到多個 call site。它們也降低 leverage：既有 interface 無法成為唯一 test surface，smoke 因而依賴 source text 與 implementation location。若繼續逐項加功能，新的 provider、renderer、pack kind 或 Host method 都會擴大相同摩擦。

## Solution

以五個可獨立驗收、按風險排序的 deepening workstreams 收斂架構：

1. 建立 deep SubDesign workspace module，讓 presentation 只消費 use cases 與 disposable UI Projection。
2. 深化 Host provider adapter module，以既有 `executeSubDesignProviderStage` 作為最高測試 seam，讓四個 real adapters 回到一致的 Host lifecycle。
3. 深化 streaming UI Projection module，以「Host snapshot + events after cursor → artifact/activity presentation」作為單一 interface。
4. 深化 OpenDesign pack application module，把 catalog record 到 project-owned content、canonical metadata、enablement 與 audit 收斂成一個 transition。
5. 保留唯一 versioned Pi Host Protocol，將內部 dispatch 深化為按 domain 組織的 modules，並集中 state/event commit behavior。

這五項不建立第二個 runtime、第二個 protocol 或 renderer authority。所有 Task run 仍通過 coordinator admission；Pi Core Host state 仍 canonical；OpenDesign 仍只是 read-only indexer；Design System Pack 仍必須安裝成 project-owned Design System；只有 trusted adapter 能產生 Execution evidence。

## User Stories

1. As a SubDesign user, I want starting a new design and continuing an existing design to follow the same lifecycle, so that behavior does not depend on which screen action I used.
2. As a SubDesign user, I want my selected model, template, Design System and plugin inputs applied consistently, so that repeated runs do not silently lose context.
3. As a SubDesign user, I want navigation and reload to rebuild the same run presentation, so that live work does not disappear or resurrect stale state.
4. As a SubDesign user, I want streaming preview and activity status to agree, so that a completed, blocked or cancelled artifact has one meaning.
5. As a SubDesign user, I want content pack installation to either complete coherently or report failure, so that the UI never claims a partial installation succeeded.
6. As a SubDesign user, I want every provider to share predictable timeout, cancellation and terminal behavior, so that integrations do not feel like separate products.
7. As a designer, I want Storybook, Chrome DevTools, Harness and fake provider results normalized consistently, so that provider choice does not alter the SubDesign lifecycle.
8. As a designer, I want static artifacts to remain usable when streaming is unavailable, so that experimental projection support never blocks delivery.
9. As a security-conscious user, I want provider execution and evidence persistence to remain Host-owned, so that renderer code cannot manufacture trusted outcomes.
10. As a security-conscious user, I want OpenDesign vendor content to remain immutable and inert until explicit installation, so that browsing content grants no runtime authority.
11. As a security-conscious user, I want every installed Design System Pack copied into a project-owned Design System, so that SubDesign never reads mutable vendor content as project policy.
12. As an operator, I want a cancelled provider result ignored even if it arrives late, so that cancellation is terminal.
13. As an operator, I want Pi Host restart and renderer reload recovery to use snapshots and cursors, so that local cache cannot overwrite newer Host state.
14. As a maintainer, I want one SubDesign workspace interface, so that create, resume, follow-up, hydration and presentation changes concentrate in one module.
15. As a maintainer, I want one provider execution interface, so that lifecycle tests do not depend on concrete adapter implementation.
16. As a maintainer, I want one streaming UI Projection interface, so that replay, ordering, terminal state and derived presentation are verified together.
17. As a maintainer, I want one pack application interface, so that copy, metadata, enablement and audit cannot drift apart.
18. As a maintainer, I want one external Pi Host Protocol interface, so that internal refactoring never creates a second desktop contract.
19. As a maintainer, I want source-text smoke guards replaced only where a higher behavioral seam exists, so that drift protection becomes stronger rather than weaker.
20. As a maintainer, I want each new module to pass the deletion test, so that the refactor removes distributed complexity instead of adding pass-through modules.
21. As a maintainer, I want dependencies accepted at test seams, so that tests can use deterministic Host events, provider adapters and filesystem outcomes.
22. As a maintainer, I want results returned through interfaces instead of inferred from side effects, so that terminal behavior is observable without reading private state.
23. As a contributor, I want adding a provider adapter to avoid edits to common lifecycle implementation, so that provider work has high locality.
24. As a contributor, I want adding a streaming event kind to avoid edits across page, preview and activity code, so that one change updates all presentations.
25. As a contributor, I want adding a pack kind to reuse one application transition, so that install policy is not copied into UI branches.
26. As a contributor, I want adding a Pi Host method to touch only its owning domain module and protocol declaration, so that unrelated Host behavior is unaffected.
27. As a contributor, I want domain vocabulary from `CONTEXT.md` preserved, so that OpenDesign, SubDesign, Design System Pack and UI Projection remain unambiguous.
28. As a reviewer, I want each workstream to name its interface, seam and invariants, so that depth can be evaluated before merge.
29. As a reviewer, I want tests to cross the same interface as production callers, so that implementation details can change safely.
30. As a reviewer, I want no new seam justified by only one adapter, so that hypothetical flexibility does not expand the architecture.
31. As a reviewer, I want Host canonical-state rules asserted in recovery tests, so that renderer convenience cannot become a competing authority.
32. As a reviewer, I want Task run admission asserted from SubDesign actions, so that UI refactoring cannot bypass `runTask`.
33. As a QA engineer, I want deterministic success, blocked, failed and cancelled cases for every relevant workstream, so that terminal states remain distinct.
34. As a QA engineer, I want replayed and out-of-order streaming events tested at the highest projection seam, so that refresh behavior matches live behavior.
35. As a QA engineer, I want provider adapters tested through common execution, so that evidence and persistence rules are exercised for every provider.
36. As a QA engineer, I want pack application tested against path traversal, missing project root and interrupted copy, so that partial state fails safely.
37. As a QA engineer, I want protocol domain tests to use version and capability negotiation, so that internal modules cannot bypass the public contract.
38. As a product owner, I want the five workstreams published as separate ready-for-agent tickets, so that progress and risk remain visible.
39. As a product owner, I want the broad Pi Host dispatcher work staged last, so that narrower locality gains land before the highest-blast-radius refactor.
40. As a product owner, I want existing user-visible behavior preserved, so that this effort improves architecture without turning into a redesign.
41. As an AI coding agent, I want concepts and tests concentrated behind deep interfaces, so that codebase navigation requires fewer unrelated files.
42. As an AI coding agent, I want implementation decisions recorded without brittle file locations, so that tickets remain useful after code moves.
43. As an AI coding agent, I want each issue to state its ADR constraints, so that automated implementation does not re-litigate settled architecture.
44. As a release owner, I want build, lint and shipped-module smoke coverage to remain green after every workstream, so that deepening can ship incrementally.
45. As a release owner, I want no permanent compatibility module left behind, so that ADR-0045 deletion discipline remains enforceable.

## Implementation Decisions

- The effort consists of five implementation issues under one architecture-deepening spec. Each issue is independently specified and uses `Status: 可交給代理`.
- The recommended execution order is workspace and provider adapter deepening first, streaming and pack application next, and Pi Host dispatch last.
- The architecture vocabulary is module, interface, implementation, depth, seam, adapter, leverage and locality. New work avoids synonymous but less precise terms.
- The SubDesign workspace module is renderer-side and owns workflow use cases plus disposable UI Projection coordination. It does not own Pi state or execute a Task run directly.
- Every SubDesign Task run continues to enter through Task run coordinator admission. UI code does not call lower dispatch or execution functions.
- The Host provider lifecycle retains the existing highest interface. Concrete provider adapters satisfy one earned seam because Storybook, Chrome DevTools, Harness and fake implementations already vary there.
- Provider-specific response shapes end inside adapters. Common lifecycle implementation consumes one normalized provider result and owns validation, cancellation, streaming, evidence acceptance, persistence and terminal projection.
- The streaming UI Projection module accepts Host snapshot state plus ordered or replayed events after a cursor and derives artifact and activity presentation. It never writes canonical state back to Host.
- Artifact manifest remains authoritative for persisted artifact identity, status, renderer and exports. Streaming content remains a disposable projection and static fallback remains available.
- The pack application module owns the coherent transition from OpenDesign catalog record to project-owned copy, canonical project metadata, enablement and audit.
- Filesystem confinement and vendor-source validation remain in Electron. Raw vendor content remains read-only, and installation never grants execution authority by itself.
- The Pi Host Protocol remains one versioned, capability-negotiated external interface. Internal domain modules do not expose additional renderer IPC contracts.
- Pi Host internal state and event commits are centralized so method-name heuristics do not become a second source of truth.
- Existing ADRs are constraints: catalog authority from ADR-0001, Pi Settings authority from ADR-0025, protocol versioning from ADR-0038, Host canonical state from ADR-0039 and removable compatibility seams from ADR-0045.
- Execution evidence remains non-model and trusted-adapter-issued under ADR-0048.
- No workstream weakens existing source drift guards before equivalent or stronger behavioral coverage exists at the confirmed interface.
- No new test framework is introduced. The effort uses the existing build, lint and shipped-module smoke toolchain.

## Testing Decisions

- A good test crosses the same highest interface used by production callers, asserts external behavior and invariants, and remains stable when implementation moves behind that interface.
- The SubDesign workspace module is tested through one use-case/projection interface covering create, start, resume, follow-up, hydrate, model override, plugin inputs and live presentation.
- Provider behavior is tested through the existing `executeSubDesignProviderStage` interface with four real adapter roles represented by deterministic adapters or fixtures.
- Streaming is tested through one new UI Projection interface from Host snapshot plus events to artifact/activity presentation. Reducer-specific tests remain only for ordering and validation invariants.
- Pack application is tested through one catalog-record-to-project transition. Electron path confinement retains focused security coverage at the existing filesystem seam.
- Pi Host dispatch is tested through the versioned Pi Host Protocol. Internal domain modules are not substituted for end-to-end protocol behavior.
- Tests cover success, blocked, failed, cancelled, timeout, duplicate/replayed event, stale snapshot, missing project root, interrupted persistence and late completion.
- Recovery tests prove renderer state is rebuilt from Host snapshot and cursor events and never pushed back as canonical state.
- Security tests prove renderer code cannot execute providers, issue evidence, read raw connector tokens or select arbitrary host paths.
- Prior art includes OpenDesign pipeline, provider, streaming, snapshot and qualification smokes; Pi Host protocol and recovery smokes; SubDesign studio smokes; and existing source drift guards.
- Source-text assertions may remain as ownership guards, but behavioral correctness moves to the confirmed interface test surfaces.
- Every issue must pass build/typecheck, lint for touched sources and the complete smoke chain before resolution.

## Out of Scope

- A visual redesign of SubDesign or its landing/studio presentation.
- New OpenDesign Plugin Contract fields, providers, renderer kinds or pack kinds.
- Replacing Pi Core, Task run coordinator, Zustand, Electron or the versioned Pi Host Protocol.
- Making renderer state canonical or introducing two-way Host/renderer synchronization.
- A second provider runtime, browser loop, agent runtime or protocol.
- Changing Approval Mode, Outbound Data Gate, capability grants or Execution evidence policy.
- Re-indexing or materially changing vendored OpenDesign content.
- Automatic remote updates or implicit installation of vendor content.
- Broad performance optimization unrelated to the five confirmed modules.
- Deleting compatibility seams before their behavioral parity and deletion gates are satisfied.

## Further Notes

- The five child issues are the executable source of work; this document records the shared problem, constraints and test philosophy.
- Issues 01 and 02 may be implemented independently. Issue 03 follows 01, issue 04 follows 01, and issue 05 follows 02 and 03 because it absorbs the stabilized provider/streaming ownership into protocol-domain dispatch.
- The top recommendation remains the SubDesign workspace module because it is the highest-churn module and currently has the weakest behavioral interface test surface.
- Any implementation that merely moves existing code into equally wide pass-through modules fails the deletion test and does not satisfy this spec.
