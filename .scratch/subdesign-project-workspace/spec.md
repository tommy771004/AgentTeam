# SubDesign 專案工作區與流程導向 Studio

Status: 可交給代理

## Problem Statement

使用者已能在 SubDesign 建立可 deep-link 的 brief、在同一頁啟動 task run、查看 artifact、執行多輪 Critique Theater 並交付結果；但這些能力以長頁面區塊分散呈現。當設計執行中、同一 brief 累積多個 artifact 或使用者從「繼續最近設計」回來時，使用者無法立即理解自己正處於 Brief、Direction、Build、Critique 或 Deliver 的哪個階段，也不容易知道下一個 gate、阻擋原因與應採取的動作。

這使 SubDesign 雖然在能力上接近 Open Design 的「brief → direction → build → critique → deliver」流程，使用體驗仍不像一個持續的專案工作區。使用者需要自行在 run feed、artifact rail、critique 與 delivery 區塊之間重新建立脈絡，尤其在長時間 task run 與多 revision 情境中更明顯。

## Solution

將既有 SubDesign brief detail 改為以「階段導向 Studio」為主要資訊架構。每個 `/subdesign/:briefId` 仍是單一 SubDesign 專案工作階段，固定提供 Brief、Direction、Build、Critique、Deliver 五個階段、目前 gate、阻擋理由、最新輸出與使用者下一步。

這是現有能力的重組，不是新增另一個 agent runtime。專案工作區僅讀取既有 brief、selected artifact、run-scoped activity、critique 結果與 delivery eligibility；所有執行仍經由 `taskRunCoordinator.runTask`，Critique Theater 仍維持真實多輪多 panelist 的既有契約，交付仍受 critique gate 保護。

Variant A（階段導向 Studio）為正式方案。Variant B 的 activity timeline 作為執行中 inspector 的呈現素材；Variant C 的 artifact-first workspace 留待多 artifact／revision 工作流有明確需求時再評估，不納入本次正式範圍。

## User Stories

1. As a SubDesign 使用者, I want to see the five design stages for my current brief at all times, so that I know where the project is in its lifecycle.
2. As a SubDesign 使用者, I want the current stage to be visually distinct from completed, pending, and locked stages, so that I can assess progress without reading raw run events.
3. As a SubDesign 使用者, I want to see the next gate and its reason, so that I know what must happen before I can continue or deliver.
4. As a SubDesign 使用者, I want a clear blocked reason when a stage is unavailable, so that I do not mistake a product rule for a broken UI.
5. As a SubDesign 使用者, I want to remain on the same deep-linked brief URL while a build is running, so that I can safely refresh, bookmark, share, and return to the same design context.
6. As a SubDesign 使用者, I want the live task activity to be connected to the active Build stage, so that tool activity has an understandable product outcome.
7. As a SubDesign 使用者, I want to see the latest output alongside the active stage, so that I know what artifact the current or last run produced.
8. As a SubDesign 使用者, I want to open the complete thread transcript deliberately, so that I can investigate details without being forced out of the Studio.
9. As a SubDesign 使用者, I want a brief summary of the chosen Design System and direction lock, so that I can confirm the build is following the intended visual contract.
10. As a SubDesign 使用者, I want to see whether critique is pending, running, passed, failed, or interrupted, so that I understand why delivery is enabled or locked.
11. As a SubDesign 使用者, I want delivery affordances to remain visibly locked until critique passes, so that I cannot mistake an incomplete artifact for a deliverable.
12. As a SubDesign 使用者 returning to a recent brief, I want to see the last stage, latest artifact, and next actionable gate before entering it, so that I can resume work confidently.
13. As a SubDesign 使用者 with multiple artifacts, I want the selected artifact to stay clear while I review progress and critique, so that I do not critique or deliver the wrong revision.
14. As a SubDesign 使用者, I want all standard controls to continue using the existing task, critique, tweak, and delivery flows, so that the new layout does not create inconsistent behavior.
15. As a SubDesign 使用者 in the browser preview, I want unavailable workspace-write actions to remain explicitly unavailable, so that I understand the Electron boundary.
16. As a SubDesign 使用者, I want the project header to show a concise runner/model/capability summary when available, so that I can understand how the current design was produced without exposing credentials.
17. As a SubDesign 使用者, I want the workspace to work when no task run is active, so that completed and paused briefs remain useful to inspect.
18. As a SubDesign 使用者, I want an empty-artifact state that explains the next permitted action, so that a newly created brief is not an ambiguous blank page.
19. As a SubDesign 使用者, I want the workspace to preserve the existing responsive behavior, so that I can use the design flow on narrower desktop and browser-preview widths.
20. As a product owner, I want stage status to be derived from canonical SubDesign state rather than duplicated UI state, so that progress cannot drift from real execution and critique outcomes.
21. As a product owner, I want the rollout to preserve the existing default single-run behavior and optional capped concurrency, so that a layout change does not alter task admission policy.
22. As a product owner, I want the Studio to make delivery rules more legible without relaxing them, so that artifact trust remains intact.
23. As an engineer, I want one derived project-workspace seam that combines existing state for the UI, so that tests and future layout changes do not duplicate lifecycle logic.
24. As an engineer, I want the development-only A/B/C prototype to remain isolated from production routing, so that research UI cannot accidentally become a second production workflow.
25. As an engineer, I want no raw OAuth tokens, secrets, or credential metadata rendered in the workspace summary, so that the existing Electron main-process vault boundary remains intact.
26. As a support or QA user, I want visible run, critique, and gate state in a single view, so that I can diagnose why a brief is stalled without reconstructing the flow from a transcript.

## Implementation Decisions

- Formalize the existing SubDesign lifecycle as a presentation-only project workspace model with five stages: Brief, Direction, Build, Critique, Deliver. The model must describe each stage's state, current stage, next gate, blocked reason, and primary next action.
- The workspace model is the single new test seam. It derives data from canonical SubDesign brief state, selected artifact/revision, run-scoped presentation/activity, critique result/session, and delivery eligibility. It must not persist its own stage state or invoke any runner.
- Replace the brief detail's long-page emphasis with Variant A's stage-oriented hierarchy: persistent project header, stage rail, project context, current gate, active/live content, and existing artifact/review/delivery content arranged under the current context.
- Reuse the existing run activity presentation for the Build inspector. Activity wording should explain both the event and the expected project outcome where known; it must not invent completion or DoD status for external CLI runs.
- Reuse the existing artifact rail, preview, tweak controls, Critique Theater, critique panel, and delivery panel. Their existing selection, mutation, permission, and delivery-gate contracts remain the source of truth.
- Reuse the current deep brief route and resume behavior. No new router, thread identity, brief identity, or task ingress path may be introduced.
- Keep all task starts on the canonical coordinator ingress. UI actions may request existing SubDesign operations but must not dispatch runners directly.
- Preserve Critique Theater's accepted real multi-pass requirement: presentation may summarize its status, but it may not synthesize panelists, rounds, scores, or a pass verdict.
- Project context displays the selected Design System, direction lock, template/surface, current artifact, and a safe runner/model/capability summary when these values are available. Credential values and raw token data are never part of this view model.
- Enhance recent-brief cards with derived resume information: latest stage, latest artifact if present, active/terminal run state, and next gate. The cards remain navigation controls, not alternate task execution surfaces.
- Provide explicit empty, inactive, running, critique-pending, critique-interrupted, critique-failed, critique-passed, and delivery-locked presentation states. All wording must distinguish absence of a run from a failed run.
- Keep production scope to Variant A. Variant B contributes interaction patterns for the running inspector only. Variant C is retained as a prototype reference and does not introduce a file-tree IDE or revision-management subsystem.
- Retain the development-only prototype guard and its no-mutation behavior until the formal layout is accepted and delivered; remove or archive it only as a deliberate follow-up, never by silently promoting it.
- Preserve responsive layout behavior through stacked regions and a readable stage summary; desktop remains the primary Electron target.

## Testing Decisions

- Test externally observable project-workspace behavior, not component internals or CSS implementation details. A good test supplies canonical state and asserts the resulting current stage, next gate, blocked reason, primary action, and safe summary.
- Add focused tests for the workspace view-model seam covering: a newly created brief with no artifact; a running build; a completed build awaiting critique; a running critique; interrupted/failed critique; passed critique enabling delivery; and multiple artifact revisions with a selected revision.
- Add negative tests confirming the view model does not mark external CLI success as DoD/critique success, does not enable delivery without a passing critique, and does not expose secret/token values.
- Extend the existing SubDesign capability smoke contract to assert that the production Studio continues to use the canonical brief route, in-page run presentation, critique gate, artifact selection, and coordinator ingress.
- Extend the production-module smoke suite where the view model can be imported as a pure TypeScript module. These tests should follow the repository's existing real-import production-module pattern.
- Use the existing scenario smoke harness for a run-scoped regression: active activity must belong to the current brief's linked task run and must not leak from another concurrent run.
- Validate the responsive layout manually in the Electron app and browser preview at desktop and narrow widths. Verify that stage, gate, selected artifact, critique status, and delivery status remain discoverable without executing a task.
- Run `npm run build`, `npm run smoke`, `npx oxlint src`, and `git diff --check` for the implementation. Existing unrelated lint warnings may be reported separately but must not be attributed to this feature.

## Out of Scope

- Creating a second SubDesign runtime, runner, store, stream, or task admission path.
- Changing `taskRunCoordinator` capacity, concurrency, queue, approval, or cancellation semantics.
- Changing the Critique Theater's real multi-pass engine, scoring policy, or delivery eligibility policy.
- Introducing a project-scoped model override editor, runner chooser, or credential editor. This release only displays a safe summary when existing state provides one.
- Building Variant C's full IDE/file-tree/revision-management model.
- Adding collaboration, comments, cloud sync, server persistence, or cross-user sharing beyond existing local deep links.
- Replacing existing artifact tweak, export, Design System, or reference-import capabilities.
- Promoting prototype placeholder content or fake actions into the production Studio.

## Further Notes

- This spec uses the repository's terminology: **SubDesign** is the in-app workflow; **OpenDesign** is the local read-only vendor content layer; **Open Design** is the upstream product used only as a design reference.
- The selected design direction follows the completed UI prototype and analysis: Variant A is the minimum-risk path because it composes current state and components instead of altering lifecycle behavior.
- The feature should be implemented as a staged UI refactor. No user migration is required because brief URLs, stored artifacts, critique data, and delivery records retain their existing identities.
- The next workflow is ticket decomposition under this feature directory, with the workspace view model and its tests preceding production layout rearrangement.
