# 04 — Deepen OpenDesign pack application

Status: resolved

## Comments

- 2026-08-28 implemented: `applyOpenDesignPack` 集中 catalog validation、Electron copy、canonical metadata、local projection 與 audit；canonical persist 失敗不 commit projection。`smoke-subdesign-architecture.mts` 已掛主鏈。

Blocked by: 01

## Parent

[Deepen the OpenDesign → SubDesign architecture](../spec.md)

## Problem Statement

OpenDesign catalog is already the single source of truth for installable templates、skills and Design System Packs, but one install action crosses catalog normalization、page selection、renderer local cache、project metadata、Electron copy/path validation、plugin registry activation and audit. Some pack state can be recorded without a project-owned copy, while Design System behavior additionally requires project refresh and a `DESIGN.md` destination.

Users can encounter partial or confusing states where content appears installed locally but is not project-owned or enabled coherently. Maintainers must understand several modules and storage authorities to change one pack rule. Source guards check implementation locations because there is no single catalog-record-to-project transition available as the interface test surface.

## Solution

Create a deep OpenDesign pack application module. Its interface receives an authoritative catalog record plus project context and performs one coherent transition: validate eligibility, copy immutable vendor content into a project-owned destination through Electron, persist canonical project metadata, update local projection/cache, enable applicable runtime registration and append audit evidence.

Browsing remains read-only and independent. Filesystem enforcement remains behind the existing Electron seam. A failed or interrupted transition leaves an explicit non-installed/disabled result and does not advertise success. Design System Pack installation always produces a project-owned Design System before SubDesign can select it.

## User Stories

1. As a SubDesign user, I want installing a pack to either finish completely or fail explicitly, so that I never see a partial success.
2. As a SubDesign user, I want installed content to belong to the active project, so that another project does not inherit it accidentally.
3. As a SubDesign user, I want a Design System Pack copied into a project-owned Design System, so that design rules remain stable and editable by the project.
4. As a SubDesign user, I want a skill pack enabled only after its content and metadata are valid, so that capability injection never points to missing files.
5. As a SubDesign user, I want an upstream digest change to disable stale enablement, so that changed vendor content requires a deliberate decision.
6. As a SubDesign user, I want install, enable, disable and rejection recorded, so that pack state is explainable.
7. As a SubDesign user, I want browsing templates to work without installing them, so that exploration grants no authority.
8. As a security-conscious user, I want vendor paths confined to the bundled OpenDesign root and project destination, so that a manifest cannot copy arbitrary files.
9. As a security-conscious user, I want installation itself to grant no provider, shell, network or connector authority, so that content remains inert by default.
10. As a maintainer, I want one pack application interface across template, skill, prompt and Design System Pack kinds, so that policy has locality.
11. As a maintainer, I want project metadata to be canonical for portability, so that local cache is only a projection and recovery aid.
12. As a maintainer, I want Electron to remain the filesystem enforcement adapter, so that renderer code never gains arbitrary write access.
13. As a contributor, I want adding a pack kind to reuse validation, copy, metadata and audit behavior, so that page branches do not grow.
14. As a contributor, I want catalog presentation independent from application state, so that indexing cannot execute or install content.
15. As a reviewer, I want the transition to pass the deletion test, so that removing it would redistribute real installation policy rather than remove a pass-through.
16. As a QA engineer, I want missing root, traversal, invalid digest and interrupted copy tested at one use-case seam, so that partial state fails safely.
17. As an AI coding agent, I want catalog-to-project ownership concentrated, so that pack changes do not require tracing page, store, preload and main independently.

## Implementation Decisions

- The OpenDesign catalog remains the authoritative read-only index under ADR-0001.
- The pack application module owns one transition from catalog record and project context to project-owned pack state.
- The primary interface returns an explicit success or failure result with the resulting project-owned identity and state; callers do not infer success from scattered side effects.
- Electron remains the adapter for vendor-source validation, path confinement, directory creation and copying.
- Vendor files are never modified in place. Every install copies allowed assets into a deterministic project-owned destination.
- Design System Pack installation is complete only after a valid project-owned `DESIGN.md` location exists and can be discovered as a Design System.
- Skill pack enablement is separate from browsing and occurs only after a valid installed record and readable skill entry exist.
- Installation alone grants no runtime capability. Existing plugin trust and capability grant rules remain authoritative.
- Project metadata is canonical for installed pack portability. Renderer local cache is a disposable projection and migration aid, not a competing source of truth.
- Audit records cover install, enable, disable, reindex invalidation, uninstall and rejection with no sensitive content.
- Digest drift disables stale enablement and requires an explicit refresh/application transition.
- Failed copy, metadata persistence or enablement does not leave the pack presented as fully installed.
- Existing pack kinds share policy; kind-specific destination or activation behavior stays internal to the module.
- Catalog loading, filtering and preview remain read-only and do not depend on a successful installation.
- The workspace module from issue 01 consumes pack application results and refreshes derived Design System presentation without owning copy policy.
- Existing filesystem security tests are preserved at the Electron seam.

## Testing Decisions

- The primary seam is the catalog-record-to-project pack application interface.
- A good test supplies a normalized record, project context and deterministic Electron adapter, then asserts the complete external result and persisted project state without reading private store actions.
- A template/skill/prompt/Design System Pack matrix proves shared transition behavior and required kind-specific outcomes.
- A Design System case proves success requires a project-owned Design System path and subsequent discovery.
- A skill case proves enablement requires an installed valid skill entry and does not occur during browsing.
- A missing-project case proves application fails explicitly and cannot create an installed project state.
- A path-security case proves absolute paths, traversal, empty path segments and out-of-root sources/destinations are rejected by Electron.
- An interruption case injects copy or persistence failure and proves no full installed state is exposed.
- A digest-drift case proves stale enablement is disabled and audit records the reindex decision.
- A recovery case proves canonical project metadata rehydrates local projection after renderer restart.
- A project-switch case proves packs do not leak between project contexts.
- An authority case proves install/enable does not bypass plugin snapshot, trust or capability grants.
- Prior art includes OpenDesign catalog, snapshot and pipeline smokes; SubDesign studio pack guards; metadata persistence smokes; and existing workspace path confinement tests.
- Source-text guards may narrow only after the transition has behavioral coverage at the primary seam.
- Verification includes inventory generation/check where relevant, build/typecheck, lint for touched sources and the complete smoke chain.

## Out of Scope

- Changing OpenDesign inventory format or re-curating vendor content.
- Automatic remote download or update of packs.
- A public marketplace, ratings, billing or account synchronization.
- Granting provider, filesystem, subprocess, network or connector authority during installation.
- Replacing project-owned Design Systems with direct vendor references.
- General filesystem refactoring outside pack application.
- A visual redesign of the template or pack picker.
- Deleting all local compatibility cache before migration behavior is proven.

## Further Notes

- This issue follows issue 01 because workspace should consume one application result instead of retaining page-specific install branches.
- Completion requires coherent failure semantics. A module that calls existing store and IPC methods without owning transition rollback/projection does not provide sufficient depth.
- ADR-0001 is reinforced, not reopened: one catalog remains authoritative and vendor content remains inert until explicit application.
