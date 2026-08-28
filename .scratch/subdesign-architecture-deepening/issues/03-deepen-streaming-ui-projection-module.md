# 03 — Deepen streaming into the UI Projection module

Status: resolved

## Comments

- 2026-08-28 implemented: `streamingProjection.ts` 由 Host snapshot + typed events 同時推導 preview/activity、cursor、fallback 與 terminal status；`smoke-subdesign-architecture.mts` 覆蓋 out-of-order、replay、conflict、terminal 及 renderer fallback，已掛 `smoke:open-design` 主鏈。

Blocked by: 01

## Parent

[Deepen the OpenDesign → SubDesign architecture](../spec.md)

## Problem Statement

Streaming envelope reconciliation already hides ordering and terminal-state behavior behind useful pure functions, but the complete renderer projection is distributed. The SubDesign page subscribes to raw Host events and maintains live envelopes, the studio selects live versus persisted runs, the preview reconciles content again and applies renderer capabilities, and activity mapping independently interprets the same event kinds.

Users can therefore receive inconsistent status between preview and activity, especially during replay, out-of-order delivery, cancellation or reload. Maintainers cannot test the promised snapshot-plus-cursor recovery through one interface, and adding an event kind or renderer capability requires edits across several modules. The reducer has depth, but the UI Projection seam remains incomplete.

## Solution

Deepen the streaming module into one renderer UI Projection module whose interface accepts a Host snapshot plus subsequent pipeline events and returns derived artifact presentation and activity presentation. The implementation owns artifact identity, update ordering, replay deduplication, terminal-state derivation, renderer capability decisions, live-versus-persisted selection and static fallback signals.

Artifact manifest and Host state remain canonical. The module's state is disposable and can be rebuilt from snapshot plus events after a cursor. Presentation modules consume derived values and never parse raw Pi Host Protocol payloads independently.

## User Stories

1. As a SubDesign user, I want streaming text to appear in order even when events arrive out of order, so that preview is coherent.
2. As a SubDesign user, I want replayed events deduplicated, so that reload does not duplicate artifact content or activity.
3. As a SubDesign user, I want preview and activity to show the same terminal status, so that completion, failure, blocked and cancellation are unambiguous.
4. As a SubDesign user, I want a cancelled stream to reject late content and done events, so that Stop remains terminal.
5. As a SubDesign user, I want a static persisted artifact shown when streaming is unsupported or unavailable, so that delivery remains accessible.
6. As a SubDesign user, I want renderer incompatibility explained without hiding content, so that I understand why fallback was used.
7. As a SubDesign user, I want navigation and reload to reconstruct current progress from Host state, so that live work survives renderer lifecycle.
8. As a SubDesign user, I want text-delta bursts kept out of the activity feed while meaningful tool and file events remain visible, so that activity stays readable.
9. As a maintainer, I want one interface from Host snapshot/events to presentation, so that replay and live behavior share implementation.
10. As a maintainer, I want raw protocol validation localized, so that page and preview do not cast untrusted payloads.
11. As a maintainer, I want artifact kind derived from authoritative artifact data rather than guessed from identifier, so that genuine artifacts render correctly.
12. As a maintainer, I want renderer capability gating owned with projection, so that preview implementations do not disagree.
13. As a contributor, I want adding a streaming event kind to update one module, so that preview and activity stay aligned.
14. As a contributor, I want adding a renderer kind to declare its capabilities once, so that streaming and fallback behavior are deterministic.
15. As a reviewer, I want UI Projection to remain disposable, so that renderer cache can never overwrite Host canonical state.
16. As a reviewer, I want no content hidden behind entrance animation, so that a failed animation cannot erase the streamed artifact.
17. As a QA engineer, I want snapshot, replay, gap, duplicate, conflict and terminal cases tested at one seam, so that recovery is trustworthy.
18. As an AI coding agent, I want streaming semantics concentrated, so that event lifecycle changes do not require tracing page, preview and activity independently.

## Implementation Decisions

- The primary module is the streaming UI Projection module within the renderer architecture established by issue 01.
- Its single external interface consumes authoritative Host snapshot data plus typed events after a cursor and returns derived presentation.
- The implementation owns deterministic ordering, deduplication, contiguous-prefix rules, terminal-state derivation and conflict rejection.
- The implementation derives both artifact preview state and activity entries from the same accepted event sequence.
- Raw `host/pipeline-stream` payload validation occurs once before events enter projection.
- Artifact identity and kind come from authoritative projection/manifest data. A temporary deterministic identifier may correlate pre-persistence events but does not redefine artifact kind.
- Artifact manifest remains authoritative for persisted identity, renderer, exports and static entry.
- Streaming envelope remains disposable and never becomes a second canonical artifact record.
- Live versus persisted provider-run selection is a projection decision, not a presentation heuristic.
- Renderer capabilities remain explicit and product-owned. Unsupported streaming yields a static fallback and reason.
- Activity suppresses noisy text deltas by policy while preserving thinking, tool, file, error, blocked, cancelled and done semantics.
- Terminal state is monotonic. Complete, error, blocked and cancelled streams reject later non-idempotent updates.
- Recovery uses Host snapshot plus cursor events and does not depend on renderer localStorage.
- Presentation modules receive already-derived content, status, error/fallback and activity data.
- Existing pure reducer behavior may remain internal; callers and most tests move to the higher projection interface.
- The work directly reinforces ADR-0039 and preserves protocol ownership under ADR-0038.

## Testing Decisions

- The primary seam is the new snapshot-plus-events UI Projection interface.
- A good test supplies a snapshot and event sequence, then asserts artifact/activity presentation without invoking React internals or reading component source.
- A live sequence case proves monotonic text, tool and file updates produce one consistent preview/activity result.
- An out-of-order case proves a terminal event does not take effect until the missing contiguous prefix arrives.
- A replay case proves identical duplicate events are idempotent and conflicting duplicates are rejected.
- A gap case proves later updates remain buffered or absent from presentation according to the existing contiguous-prefix invariant.
- A terminal case covers complete, error, blocked and cancelled and proves later updates cannot change status.
- A late-cancel case proves a provider done event cannot resurrect cancelled projection.
- A recovery case starts from a Host snapshot, applies events after a cursor and matches the equivalent uninterrupted live projection.
- A renderer case covers supported streaming, unsupported streaming, unknown renderer and static fallback.
- An artifact case proves kind comes from authoritative artifact data rather than the artifact identifier.
- An activity case proves text deltas are suppressed while meaningful control events share status and error semantics with preview.
- A no-content case proves presentation is visible by default and does not require an entrance animation to reveal it.
- Prior art includes OpenDesign streaming and pipeline smokes, Pi Host event activity mapping and Host restart UI Projection recovery smokes.
- Reducer-level tests remain for pure validation edge cases, but external behavior is owned by the higher seam.
- Verification includes build/typecheck, lint for touched sources and the complete smoke chain.

## Out of Scope

- A new transport protocol or websocket layer.
- Making renderer state canonical.
- Changing artifact manifest schema beyond what is required to consume existing authoritative fields.
- Adding new renderer or export kinds.
- Streaming arbitrary MCP Apps surfaces.
- Redesigning ArtifactPreview or activity feed visuals.
- Persisting full streaming text as a second artifact copy.
- Replacing Pi Host cursor/snapshot recovery.

## Further Notes

- This issue follows issue 01 so the projection integrates into one workspace interface rather than returning raw state to the page.
- Completion requires preview and activity to derive from one accepted event sequence. Sharing type definitions without sharing projection behavior is insufficient.
- The static artifact path must remain usable throughout the migration.
