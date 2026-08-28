# 01 — Deepen the SubDesign workspace module

Status: resolved

## Comments

- 2026-08-28 reconciliation: `workspace.ts` 已集中 create/start/resume/follow-up、hydrate、route、model、plugin 與 admission；`npm run smoke:subdesign-workspace` 從公開 controller seam 驗證並在主鏈通過。

Blocked by: None

## Parent

[Deepen the OpenDesign → SubDesign architecture](../spec.md)

## Problem Statement

SubDesign 使用者從 landing 建立 brief、回到既有 brief、重新執行或提交 follow-up 時，表面上都在操作同一個 workflow，但目前 renderer page 分別編排 thread、brief、project stores、plugin preparation、model override、Task run、provider state refresh 與 navigation。相同 run lifecycle 被複製在三條 action path，catalog、model discovery、Host streaming event 與 route hydration 也直接耦合 presentation。

對維護者而言，`SubDesignPage` 的 interface 幾乎等同整個 implementation。它需要知道大量 store methods、Host event payload、catalog cache、provider flags 與 child presentation details。行為測試缺少較小而更高的 interface，因而以 source-text assertions 驗證 implementation location。這使每次 SubDesign 變更跨越太多檔案，也讓 AI agent 難以判斷真正的 workflow owner。

## Solution

建立一個 deep renderer-side SubDesign workspace module。它以單一 interface 提供 SubDesign use cases 與 disposable UI Projection，內部集中 route/thread binding、project hydration、catalog preparation、model selection、plugin input tracking、Task run request composition、start/resume/follow-up lifecycle 與 live presentation coordination。

Presentation module 只渲染 projection 並發出 user intent。Task run 仍由既有 coordinator interface admission；Pi Core Host state 仍 canonical；workspace module 不直接呼叫 lower dispatch/execution，也不把 renderer cache 寫回 Host。

## User Stories

1. As a SubDesign user, I want creating a brief to bind its conversation exactly once, so that later runs continue in the correct thread.
2. As a SubDesign user, I want starting, restarting and following up to share one busy lifecycle, so that duplicate clicks cannot create inconsistent runs.
3. As a SubDesign user, I want selected plugin inputs preserved for the active brief and cleared when the brief changes, so that values never leak across plugins.
4. As a SubDesign user, I want selected model overrides applied to every SubDesign run path, so that follow-up does not silently use another model.
5. As a SubDesign user, I want selected Design System and template provenance applied consistently, so that the generated artifact matches my setup.
6. As a SubDesign user, I want provider state refreshed after relevant runs, so that qualification and evidence presentation stay current.
7. As a SubDesign user, I want route navigation to select the corresponding brief and thread, so that opening a bookmarked SubDesign route is deterministic.
8. As a SubDesign user, I want project switching to hydrate all SubDesign projections coherently, so that artifacts, critiques, exports and packs belong to one project.
9. As a SubDesign user, I want an unavailable browser/Electron capability to degrade visibly, so that the plain-browser preview remains usable.
10. As a maintainer, I want one workspace interface for create, start, resume, follow-up and hydrate, so that lifecycle changes have locality.
11. As a maintainer, I want presentation to consume derived projection instead of reading many stores directly, so that JSX no longer owns domain coordination.
12. As a maintainer, I want every run to enter through Task run coordinator admission, so that refactoring cannot bypass concurrency and finalization rules.
13. As a maintainer, I want Host events adapted before presentation sees them, so that raw protocol casts do not spread through the page.
14. As a maintainer, I want catalog and model discovery represented as workspace state, so that loading and warning behavior is testable without reading rendered source.
15. As a reviewer, I want the workspace module to pass the deletion test, so that removing it would reintroduce workflow complexity across presentation rather than reveal a pass-through.
16. As a reviewer, I want the workspace interface smaller than its implementation, so that callers learn only intents, projection and terminal outcomes.
17. As a QA engineer, I want create/start/resume/follow-up tests to use the same interface, so that all entry paths share invariants.
18. As an AI coding agent, I want SubDesign workflow ownership concentrated, so that a run lifecycle change can be understood without traversing unrelated presentation code.

## Implementation Decisions

- The new module is a renderer-side SubDesign workspace module, not a new runtime or canonical store.
- Its interface exposes user intents and a disposable projection. Exact method/type shapes may be designed during implementation, but the external seam remains singular.
- The module owns coordination for project hydration, route/brief/thread binding, catalog state, model discovery, plugin input state, run composition and live presentation.
- Presentation retains local-only visual state when it has no workflow meaning, such as an open panel or purely visual selection affordance.
- The module accepts dependencies for navigation, Task run admission, Host event subscription and project capabilities instead of constructing hidden alternatives.
- Create, start, resume and follow-up share one internal run path for run identity, plugin preparation, model override, busy state, Task run admission and post-run refresh.
- A blocked plugin preparation surfaces declared inputs and reason through the projection; it does not silently run without required inputs.
- The module may read existing Zustand modules as implementation details during migration, but presentation should not need their combined interface.
- Pi Host events are adapted into typed workspace inputs. Raw `window.subagents` payload casts do not remain in presentation.
- Renderer feature flags remain renderer concerns, but their effect is represented in the projection rather than scattered conditional reads.
- Task run coordinator is the only execution ingress. No UI or workspace implementation calls dispatch or execution functions directly.
- UI Projection is rebuilt from Host and project sources; no renderer cache becomes authoritative over newer Host state.
- Existing prototypes and fixtures remain development-only and do not become production workflow owners.
- The migration replaces existing coordination rather than layering a permanent second workspace path beside it.
- This decision aligns with ADR-0039 and ADR-0045 and preserves the canonical terms defined in `CONTEXT.md`.

## Testing Decisions

- The primary seam is the new highest-level SubDesign workspace interface.
- A good test issues user intents, supplies deterministic dependencies and asserts projection plus Task run requests; it does not inspect hook count, JSX source or private Zustand mutations.
- A create case proves one conversation and one brief are bound, then one Task run enters coordinator admission with the selected template, Design System, model and plugin inputs.
- A restart case proves the existing conversation is reused and no duplicate brief is created.
- A follow-up case proves the user text becomes the objective while plugin preparation, model override and busy lifecycle remain shared.
- A blocked-input case proves declared fields and reason appear in projection and no Task run begins.
- A project-switch case proves all project-owned SubDesign data is rehydrated and stale brief/plugin inputs are not reused.
- A route case proves direct navigation selects the correct brief/thread and exposes an explicit missing-brief state.
- A concurrency case proves repeated intent while busy does not create a second run, without adding a global lock across conversations.
- A capability case proves the module feature-detects Electron functions and supplies a browser-safe projection.
- A recovery case proves Host snapshot/events rebuild run presentation and renderer state never overwrites Host state.
- Prior art includes SubDesign studio smokes, Task run coordinator smokes, OpenDesign pipeline smokes and Pi Host recovery projection smokes.
- Existing source drift guards remain until equivalent workspace behavior is covered; afterwards they may narrow to ownership rules rather than implementation strings.
- Verification includes build/typecheck, lint for touched sources and the complete smoke chain.

## Out of Scope

- A visual redesign of the SubDesign landing or studio.
- New templates, Design Systems, providers, artifact renderers or model sources.
- Changing Task run coordinator concurrency, queueing or finalization policy.
- Making renderer state canonical.
- Moving Pi Core execution into the renderer.
- Replacing all existing Zustand modules in one change.
- Changing plugin trust, capability grants or provider evidence policy.
- Designing the streaming projection implementation owned by issue 03 beyond leaving one clear workspace integration point.

## Further Notes

- Completion requires a visibly smaller presentation interface and behavioral tests at the workspace seam; moving hooks into a similarly wide pass-through module is not sufficient.
- Issue 03 and issue 04 depend on this ownership being established so their projection/application modules plug into one workspace rather than back into the page.
