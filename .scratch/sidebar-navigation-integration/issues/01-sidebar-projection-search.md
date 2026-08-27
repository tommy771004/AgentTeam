# 01 — Sidebar projection and search contract

Status: resolved
Spec: `.scratch/sidebar-navigation-integration/spec.md`

## What to build

Expand the existing pure project-thread grouping seam into the single semantic projection for the conversation sidebar. It must derive ordered visible project groups, search filtering, collapsed/full visibility, truncation state and no-results state from the current thread UI Projection, active project, query and expansion state.

Search is title-only, trimmed and case-insensitive. A non-empty query searches all otherwise-visible threads, including entries beyond the normal collapsed limit. Hidden background-worker threads remain excluded. Active-project-first, recency ordering, unbound-last and empty-active-project behavior remain unchanged.

Do not read stores or browser state in the projection and do not create a second search index or persistence path.

## Acceptance criteria

- [x] One pure projection owns project grouping, title search, truncation and no-results metadata
- [x] Active project is first and may render empty outside an unmatched search result
- [x] Remaining projects are ordered by latest visible thread activity and unbound is last
- [x] Hidden threads never appear or match search
- [x] Query matching trims whitespace and ignores case
- [x] Search can return threads beyond the normal collapsed limit
- [x] Empty query preserves the current collapsed/show-more behavior
- [x] Existing grouping fixtures continue to pass and new search fixtures are added to the same smoke seam
- [x] The focused smoke is on both normal smoke gates
- [x] `npm run build` and the focused smoke pass

## Comments

Resolved at `f5a589b`. `projectThreadSidebar` is the single pure seam and `smoke-thread-project-groups.mts` covers ordering, hidden exclusion, normalized search, retained active-project context, truncation and no-results. Full evidence: [`../qualification.md`](../qualification.md).

## Blocked by

None.
