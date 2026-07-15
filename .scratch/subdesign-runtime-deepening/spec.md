# 深化 SubDesign 專案工作區模組

Category: enhancement
Status: 可交給代理

## Problem Statement

使用者在 SubDesign 中建立 brief、選定 direction、產生與修改 artifact、收集可信 evidence、執行 Critique Theater，最後交付 PDF、PPTX 或 MP4。這些能力目前可以使用，但同一套 SubDesign 規則分散在 Electron 啟動流程、IPC interface、通用工具執行、renderer stores 與 Task run 結算邏輯之間。

當 artifact revision、evidence trust、Design System 安裝或 delivery gate 發生變更時，維護者需要跨越多個 module 才能確認完整行為。現有驗證也有相當比例依賴 source-shape assertion，能證明名稱與 wiring 存在，卻無法從一個穩定 interface 驗證 metadata、檔案系統、安全規則與輸出的整體外部行為。

這會降低 locality：同一個 SubDesign 不變量可能只在部分入口被更新，造成 UI、agent tool、持久化結果與 export 結果不一致。對使用者而言，風險是 artifact 被錯誤修改、evidence 被不正確信任、未通過 gate 的內容被交付，或 Design System Pack 未依預期成為 project-owned Design System。

## Solution

將 SubDesign 專案工作區的 metadata persistence、artifact mutation、evidence trust、reference import、Design System 安裝與 delivery 行為集中在一個深層 module 中。這個 module 以一個主要 interface 提供完整的專案工作區操作，讓 renderer、agent tool 與 Electron IPC adapter 共用同一套規則。

使用者不會看到新的平行 SubDesign runtime，也不會改變既有 brief → direction → build → critique → deliver 流程。SubDesign 仍使用 canonical `runTask` agent lifecycle；OpenDesign 仍只是 read-only vendor content source；Critique Theater 仍必須完成真實的兩輪、六個 note 才能通過交付 gate。

Electron IPC 保持薄 adapter，只負責傳遞請求與結果。主要行為測試從深層 module 的 interface 執行，使用暫存 project workspace 與可替換的 export process adapter 驗證外部行為；IPC 只保留窄幅 wiring smoke。

## User Stories

1. As a SubDesign user, I want every artifact operation to use the same project workspace rules, so that results do not depend on which screen or agent tool initiated the action.
2. As a SubDesign user, I want artifact revisions to advance consistently, so that preview, critique, tweak, and delivery always refer to the intended revision.
3. As a SubDesign user, I want invalid artifact manifests rejected before files are changed, so that malformed output cannot corrupt my project workspace.
4. As a SubDesign user, I want artifact patches to validate their operations atomically, so that a partially applied patch cannot leave an inconsistent artifact.
5. As a SubDesign user, I want tweak values normalized and validated consistently, so that UI tweaks and agent-driven tweaks produce the same result.
6. As a SubDesign user, I want SubDesign metadata identifiers validated centrally, so that unsafe paths cannot escape the project workspace.
7. As a SubDesign user, I want brief, artifact, critique, export, and installed-pack metadata stored predictably, so that reopening the project restores the same workflow context.
8. As a SubDesign user, I want corrupted stored artifacts ignored with an understandable result, so that one bad record does not prevent access to valid work.
9. As a SubDesign user, I want reference imports to require a canonical brief, so that imported material is attached to the correct SubDesign project.
10. As a SubDesign user, I want imported screenshots and URLs recorded with traceable source metadata, so that I can understand where design evidence came from.
11. As a SubDesign user, I want a Design System Pack copied into my project only through the explicit install flow, so that vendor content remains inert until I choose it.
12. As a SubDesign user, I want an installed Design System to become project-owned content, so that build and critique use the same canonical `DESIGN.md` contract.
13. As a SubDesign user, I want duplicate or unsafe Design System targets rejected, so that installation cannot overwrite unrelated project files.
14. As a SubDesign user, I want captured evidence tied to the current artifact revision, so that stale evidence cannot justify delivery of newer work.
15. As a SubDesign user, I want evidence attestations verified before critique or delivery trusts them, so that manually edited evidence cannot be presented as tool-generated proof.
16. As a SubDesign user, I want evidence content checked for the expected semantic shape, so that an unrelated file cannot satisfy a screenshot, lint, or report requirement.
17. As a SubDesign user, I want lint evidence to identify structural and accessibility findings, so that I can correct issues before delivery.
18. As a SubDesign user, I want a missing or invalid direction gate explained clearly, so that I know why artifact mutation is blocked.
19. As a SubDesign user, I want Critique Theater delivery eligibility evaluated from canonical critique data, so that presentation state cannot unlock delivery by itself.
20. As a SubDesign user, I want incomplete, interrupted, or failed critique sessions to keep delivery locked, so that unfinished review is never reported as approval.
21. As a SubDesign user, I want PDF export to preserve the selected artifact content and revision, so that the delivered document matches the preview I approved.
22. As a SubDesign user, I want PPTX export to preserve the selected artifact content and revision, so that the delivered deck is traceable to its source.
23. As a SubDesign user, I want MP4 export failures reported without creating a false success record, so that I can retry or choose another format confidently.
24. As a SubDesign user, I want export filenames sanitized consistently, so that delivery works safely across supported operating systems.
25. As a SubDesign user, I want export metadata written only after the delivery result is known, so that the project does not claim an output that was never produced.
26. As a SubDesign user, I want browser preview to degrade gracefully when Electron-only operations are unavailable, so that unsupported actions are explicit instead of silently simulated.
27. As an agent tool caller, I want one SubDesign project workspace interface, so that tool execution does not reconstruct domain rules independently.
28. As an agent tool caller, I want projectRoot and run identity preserved through every operation, so that concurrent Task runs cannot modify the wrong project.
29. As a Task run maintainer, I want SubDesign finalization summaries derived from canonical workspace results, so that Archive links and result summaries stay consistent with persisted artifacts.
30. As a security maintainer, I want workspace path validation and evidence trust rules concentrated in one module, so that one fix protects every caller.
31. As a test author, I want to exercise SubDesign behavior through one interface with a temporary workspace, so that tests observe real persistence and file effects without launching the full renderer.
32. As a test author, I want export processes replaceable by mock adapters, so that success, failure, cancellation, and malformed-output cases are deterministic.
33. As a maintainer, I want Electron IPC to remain a thin adapter, so that transport wiring does not become a second implementation of SubDesign rules.
34. As a maintainer, I want source-shape assertions limited to narrow drift guards, so that behavioral tests catch ordering and composition bugs.
35. As a maintainer, I want OpenDesign catalog and Critique Theater ADR decisions preserved, so that architectural deepening does not reopen settled product behavior.

## Implementation Decisions

- Build one deep SubDesign project workspace module. Its interface is the primary seam for callers and tests; its implementation owns project workspace operations that currently require coordinated knowledge across generic Electron, tool, store, and finalization modules.
- Keep SubDesign on the canonical Task run lifecycle. The new module is not a separate execution runtime, scheduler, or agent engine.
- Keep renderer stores responsible for presentation state and UI coordination. They consume canonical results and must not duplicate artifact validation, evidence trust, installation, or delivery rules.
- Keep Electron IPC as a thin adapter over the deep module. IPC handlers validate transport-level input shape, invoke the module, and return its result without reconstructing domain behavior.
- Concentrate metadata path resolution, identifier safety, serialization, hydration, and corruption handling inside the module implementation.
- Concentrate artifact manifest validation, patch application, tweak normalization, revision handling, and project file mutation inside the module implementation.
- Concentrate evidence capture, semantic verification, cryptographic attestation, revision binding, and lint result construction inside the module implementation.
- Concentrate reference import, project-owned record creation, and source traceability inside the module implementation.
- Preserve OpenDesign as the single source of truth for installable vendor content. A Design System Pack remains read-only until the module explicitly installs it as a project-owned Design System.
- Preserve the canonical project-owned Design System contract and its `DESIGN.md` representation. Do not introduce a second design-system source or merged fallback catalog.
- Preserve Critique Theater’s real two-round, three-panelist-per-round process. Delivery eligibility continues to require the canonical completed critique result and must not be inferred from UI presentation.
- Treat export processes as real variation behind an internal seam. Production process adapters generate supported delivery formats; mock adapters support deterministic behavioral tests.
- Accept environment dependencies rather than creating them inside domain operations: project workspace access, user-data secret storage, temporary directory access, clock, and export processes.
- Keep the external module interface smaller than its implementation. Internal helpers and internal seams remain private unless two real adapters or callers require variation.
- Return explicit results for success, validation failure, unavailable operation, rejected gate, and export failure. Do not use thrown transport errors as the only domain outcome.
- Preserve projectRoot, runId, threadId, artifact id, brief id, and revision identity wherever the operation requires them. Do not re-resolve mutable UI selection state inside the module.
- Preserve plain-browser feature detection. Electron-only behavior returns an explicit unavailable outcome rather than pretending the operation succeeded.
- Derive Task run summaries and Archive links from canonical persisted results. Finalization must not independently reconstruct SubDesign rules from multiple stores.
- Retire duplicated or pass-through implementation only after callers use the deep module. Do not retain parallel legacy and canonical paths as permanent compatibility seams.
- Apply the deletion test at completion: deleting the old generic-host implementation should remove indirection, while deleting the new deep module would cause its rules to reappear across multiple callers.

## Testing Decisions

- The primary test surface is the deep SubDesign project workspace module interface. Tests verify external behavior and persisted workspace results, not private helper calls or source layout.
- Use a real temporary project workspace for metadata, artifact, reference, Design System, evidence, lint, and export-record behavior.
- Inject deterministic clock, user-data secret storage, temporary directory, and export process adapters where environment behavior varies.
- Test artifact creation, patching, tweak application, revision advancement, invalid operations, unsafe identifiers, and atomic failure through the primary interface.
- Test metadata hydration with valid, missing, malformed, stale, and mixed records. One corrupt record must not hide unrelated valid project work.
- Test reference imports against valid briefs, missing briefs, unsafe sources, and repeated imports while observing project-owned records.
- Test Design System Pack installation through the catalog-selected flow, including safe target creation, duplicate handling, invalid manifests, and proof that vendor content remains unchanged.
- Test evidence capture and verification across matching revision, stale revision, modified content, missing attestation, invalid source, wrong semantic kind, and valid lint evidence.
- Test delivery gates with critique pending, running, interrupted, failed, incomplete, passed, and stale-artifact conditions. Only the canonical passing result may enable delivery.
- Test PDF, PPTX, and MP4 outcomes with mock export adapters for success, failure, cancellation, empty output, malformed output, and unavailable dependency cases.
- Test that export metadata is not written before successful output and that failed export cannot appear as delivered.
- Test two concurrent Task runs using different project roots and artifact identities to prove operations cannot cross project or run scope.
- Test plain-browser unavailable outcomes independently from Electron behavior; unsupported actions must remain explicit and non-successful.
- Keep one narrow Electron IPC smoke covering handler registration, request forwarding, result forwarding, and the absence of raw secret material in renderer-visible data.
- Keep one narrow drift guard preventing SubDesign domain implementation from returning to generic Electron bootstrap, generic tool execution, or Task run finalization modules.
- Replace broad source-string assertions when the same guarantee is observable through the primary interface. Retain source-shape checks only for architectural constraints that cannot be proven behaviorally.
- Reuse the production-module smoke harness and its temporary-workspace patterns as prior art. Extend capability smoke only where agent tool registration, forced approval, or Critique Theater sequencing must remain integrated.
- Run the full existing verification sequence after migration: production-module smoke, capability smoke, scenario E2E, marketplace smoke, TypeScript build, Electron/Vite build, oxlint, and diff checking.

## Out of Scope

- Redesigning the SubDesign Studio UI, stage rail, inspector, Critique Theater presentation, artifact preview, tweak controls, or delivery controls.
- Creating a second SubDesign app, execution runtime, agent engine, scheduler, queue, or Task run lifecycle.
- Changing the brief → direction → build → critique → deliver workflow.
- Changing ADR-0001’s OpenDesign catalog source-of-truth decision or reintroducing a hardcoded template fallback.
- Changing ADR-0002’s real two-round, six-note Critique Theater requirement.
- Changing ADR-0003’s default single-run behavior, opt-in concurrency cap, queue policy, HITL routing, or run-scoped identity rules.
- Adding new artifact formats, export formats, critique panelists, critique rounds, Design System formats, or OpenDesign content kinds.
- Changing artifact, brief, critique, export, or Design System persisted schema unless a compatibility-preserving migration is strictly required to concentrate the implementation.
- Replacing Zustand presentation stores, Electron IPC, the canonical Task run interface, or the existing capability system.
- Introducing a new dependency, workflow framework, database, event bus, or general-purpose repository abstraction.
- Creating one file or one public interface per operation. Internal organization should increase depth rather than reproduce the current implementation as many shallow modules.
- Refactoring built-in tool registration or Content Publishing adapters except for minimal call-site adjustments required by the SubDesign module migration.

## Further Notes

- `SubDesign` remains the product term for the in-app design workflow. The deepened module is an implementation detail of that workflow, not a separate product or runtime.
- `OpenDesign` remains a read-only vendor content index and installer source. A Design System Pack becomes a Design System only after explicit project installation.
- The interface is the test surface: if a behavior test must import internal metadata, evidence, patch, or export helpers, the module has not yet achieved the intended depth.
- One external Electron IPC adapter alone does not justify additional public seams. Internal export adapters are real because multiple production formats and deterministic test replacements vary at that location.
- The deletion test is the completion lens: removing the legacy generic-host implementation should concentrate complexity rather than redistribute it.
- The preceding architecture review selected this as the top recommendation while preserving the canonical Task run lifecycle and accepted ADRs.
