# 02 — Conversation sidebar interactions

Status: resolved
Spec: `.scratch/sidebar-navigation-integration/spec.md`

## What to build

Integrate the reference design's useful interaction patterns into the real task conversation sidebar without importing its demo data or dependencies.

Add an expandable title search that renders the sidebar projection from ticket 01, supports clear and Escape behavior, and preserves project grouping. Convert conversation selection into valid native interactive semantics. Replace the three hover-only row actions with one accessible overflow menu that delegates delete, fork and replay-safe checkpoint rerun to the existing action contracts.

Keep new conversation, running/parsing status, project selection follow behavior, show-more behavior, mobile auto-close and plain-browser degradation intact. All required controls must remain discoverable by keyboard and must not depend on an opacity entrance animation.

## Acceptance criteria

- [x] Search opens, accepts input, filters immediately, clears and closes with Escape
- [x] A no-results state distinguishes an empty match from loading
- [x] Search results remain grouped by real project identity
- [x] Conversation rows are native selectable controls with selected/current semantics
- [x] One overflow trigger exposes delete, fork and replay-safe rerun without nested buttons
- [x] Menu dismissal restores focus to its trigger
- [x] Existing durable delete/archive behavior is reused
- [x] Existing local and external-session fork behavior is reused
- [x] Existing replay-safe checkpoint contract is reused
- [x] Running/parsing status remains visible and semantically labelled
- [x] Hidden background-worker threads remain absent
- [x] Mobile selection still closes the conversation drawer
- [x] No fake workspace, recent conversation, Upgrade, Invite, Sign out or New workspace UI is introduced
- [x] `npm run build` and `npx oxlint src` pass

## Comments

Resolved at `f5a589b`. Thread actions are delegated through `useThreadConversationActions`; the overflow is a Radix Dropdown Menu with verified arrow navigation and focus restoration. Full evidence: [`../qualification.md`](../qualification.md).

## Blocked by

01 — Sidebar projection and search contract.
