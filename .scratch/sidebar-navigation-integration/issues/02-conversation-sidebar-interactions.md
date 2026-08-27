# 02 — Conversation sidebar interactions

Status: 可交給代理
Spec: `.scratch/sidebar-navigation-integration/spec.md`

## What to build

Integrate the reference design's useful interaction patterns into the real task conversation sidebar without importing its demo data or dependencies.

Add an expandable title search that renders the sidebar projection from ticket 01, supports clear and Escape behavior, and preserves project grouping. Convert conversation selection into valid native interactive semantics. Replace the three hover-only row actions with one accessible overflow menu that delegates delete, fork and replay-safe checkpoint rerun to the existing action contracts.

Keep new conversation, running/parsing status, project selection follow behavior, show-more behavior, mobile auto-close and plain-browser degradation intact. All required controls must remain discoverable by keyboard and must not depend on an opacity entrance animation.

## Acceptance criteria

- [ ] Search opens, accepts input, filters immediately, clears and closes with Escape
- [ ] A no-results state distinguishes an empty match from loading
- [ ] Search results remain grouped by real project identity
- [ ] Conversation rows are native selectable controls with selected/current semantics
- [ ] One overflow trigger exposes delete, fork and replay-safe rerun without nested buttons
- [ ] Menu dismissal restores focus to its trigger
- [ ] Existing durable delete/archive behavior is reused
- [ ] Existing local and external-session fork behavior is reused
- [ ] Existing replay-safe checkpoint contract is reused
- [ ] Running/parsing status remains visible and semantically labelled
- [ ] Hidden background-worker threads remain absent
- [ ] Mobile selection still closes the conversation drawer
- [ ] No fake workspace, recent conversation, Upgrade, Invite, Sign out or New workspace UI is introduced
- [ ] `npm run build` and `npx oxlint src` pass

## Blocked by

01 — Sidebar projection and search contract.
