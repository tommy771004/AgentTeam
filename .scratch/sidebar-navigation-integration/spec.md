# Sidebar navigation integration

Status: 可交給代理

Design input: [`docs/ui/Sidebar Nav.md`](../../docs/ui/Sidebar%20Nav.md)

## Problem Statement

SubAgents AI 現在同時有一個負責全域 route navigation 的應用程式側欄，以及一個只在 task conversation 首頁出現、負責 project 與 conversation thread 的列表。兩者的 row 密度、active state、收合行為、surface treatment 與操作配置並不一致；conversation thread 變多後又缺少搜尋，刪除、fork 與 replay-safe checkpoint 重跑則擠成三個 hover-only icon，難以發現且不利鍵盤操作。

參考設計提供了緊湊 row、可展開搜尋、workspace summary、recent conversations 與收合 rail 等可用方向，但它本身是 demo component：內含假的 workspace、假的 recent conversations、無實際行為的 menu、Upgrade CTA，以及專案未使用的 icon 和 glide-menu dependencies。若整份搬入，會在既有兩個 navigation owner 之外建立第三套 active、collapse 與 workspace state，並可能讓 renderer UI Projection 被誤當成 conversation authority。

使用者需要的是一套整合後的 sidebar experience：看起來、操作起來像同一個產品，同時保留 route navigation、project context、conversation thread 與 Pi Core Host UI Projection 的正確責任邊界。

## Solution

保留現有雙層資訊架構：應用程式側欄繼續擁有全域 route navigation、Pi Host status 與 shell collapse；task conversation 側欄繼續擁有 project-grouped thread list、new conversation、select、delete、fork 與 replay-safe rerun。兩者共享同一套 sidebar row visual language，但不共享會混淆責任的狀態。

conversation 側欄加入可展開的本地搜尋，以單一純 sidebar projection 從 Host-backed thread UI Projection 推導可見 project groups。搜尋不寫回 store、不建立 durable index，也不改變 project binding。每個 thread row 改為語意正確、可鍵盤操作的選取控制，次要 actions 收進一個 overflow menu；所有 actions 仍委派既有 store/coordinator contracts。Project summary 只呈現目前 project context，若提供切換入口也只開啟既有 project picker，不建立另一份 workspace state。

視覺整合沿用既有 design tokens 與 icon system，移除 demo data、dead controls、hover boop、gliding highlight、過量 glow、pill、hairline 與 hover-only content。必要內容預設可見，motion 只處理 width、tone 或 icon state，並尊重 reduced motion。Run capability diagnostics 移出 navigation footer，讓 sidebar 專注於 wayfinding。

## User Stories

1. As a SubAgents AI user, I want global product destinations and task conversations to remain visibly distinct, so that I understand whether I am navigating the app or switching conversation context.
2. As a SubAgents AI user, I want both sidebar regions to use the same spacing and interaction language, so that the product feels coherent rather than assembled from unrelated components.
3. As a task conversation user, I want to search conversations by title, so that I can find an older thread without scanning every project group.
4. As a task conversation user, I want search to update immediately as I type, so that locating a thread feels direct.
5. As a task conversation user, I want search matching to ignore letter case and surrounding whitespace, so that minor input differences do not hide a result.
6. As a task conversation user, I want search results to remain grouped by project, so that I retain the execution context of every conversation.
7. As a task conversation user, I want the active project group to remain identifiable while searching, so that search does not erase my current context.
8. As a task conversation user, I want an honest no-results state, so that an empty sidebar is not mistaken for a loading failure.
9. As a task conversation user, I want to clear search in one action, so that I can return to the complete grouped list quickly.
10. As a keyboard user, I want Escape to close or clear the expanded search, so that the interaction does not trap focus.
11. As a keyboard user, I want every conversation row to be a real focusable control, so that Enter or Space selects it predictably.
12. As a screen-reader user, I want the selected conversation and current route announced semantically, so that active state is not conveyed only by color.
13. As a keyboard user, I want the conversation action menu to open, navigate, close and restore focus correctly, so that delete, fork and replay-safe rerun are fully usable without a pointer.
14. As a pointer user, I want one stable overflow action per conversation, so that row titles do not jump or become crowded when I hover.
15. As a task conversation user, I want deleting a conversation to use the existing durable archive/tombstone behavior, so that the new sidebar does not create a renderer-only delete path.
16. As a task conversation user, I want forking a conversation to preserve the existing local and external-session behavior, so that visual integration does not weaken session continuity.
17. As a task conversation user, I want replay-safe rerun to retain its trusted checkpoint contract, so that the new menu cannot imply unsafe replay.
18. As a task conversation user, I want running or parsing conversations to retain a semantic status indicator, so that concurrent work remains discoverable.
19. As a task conversation user, I want hidden background-worker threads excluded, so that implementation sessions never leak into the navigation.
20. As a task conversation user, I want the active project to appear even before it has a conversation, so that the empty state accurately reflects my selected project.
21. As a task conversation user, I want unbound conversations clearly grouped as unbound, so that they are not presented under a false project.
22. As a user with many conversations, I want the existing show-more behavior to coexist with search, so that the normal list stays compact while search can still find older threads.
23. As a user creating a conversation, I want the existing new-conversation action to remain available in the sidebar header, so that integration does not add an alternate creation path.
24. As a mobile user, I want selecting a conversation to close the drawer, so that the conversation content becomes visible immediately.
25. As a mobile user, I want the backdrop and close controls to remain functional, so that the drawer cannot strand me in the navigation layer.
26. As a desktop user, I want the app navigation rail to keep one shell-owned collapse state, so that route navigation does not fight task-page state.
27. As a user who changes projects, I want any sidebar project control to delegate to the existing project picker, so that the displayed and executed project cannot diverge.
28. As a user composing a task, I want the authoritative project context to remain visible near task submission, so that a decorative sidebar summary never replaces execution context.
29. As a user monitoring Pi Core Host, I want Host health and live-run entry to remain in the app shell, so that navigation polish does not hide operational status.
30. As a user, I do not want demo actions such as Upgrade, Invite users, Sign out or New workspace unless the product implements them, so that every visible control is real.
31. As a user, I want sidebar content visible without waiting for an entrance animation, so that throttling, background tabs or reduced motion cannot produce an empty navigation area.
32. As a user who prefers reduced motion, I want collapse, search and menu transitions to avoid unnecessary animation, so that the interface respects my system preference.
33. As a low-vision user, I want labels, active states and focus rings to maintain readable contrast, so that the compact sidebar remains legible.
34. As a user resizing the desktop window, I want text and controls to remain inside their visible region, so that collapse and clipping never shave labels or icons.
35. As a user, I want active rows to stay still on hover and press, so that navigation feels precise rather than jumping.
36. As a user, I want the sidebar to avoid excessive glow, shadow and decorative pills, so that information hierarchy remains clearer than material effects.
37. As a maintainer, I want route navigation to remain owned by the shell and conversation actions to remain owned by the conversation surface, so that integration does not create a third navigation controller.
38. As a maintainer, I want all visible conversation groups derived from one pure projection, so that search, grouping, truncation and hidden-thread policy cannot drift between render paths.
39. As a maintainer, I want renderer state to remain a disposable UI Projection of Pi Core Host session state, so that sidebar search never becomes a second durable conversation store.
40. As a maintainer, I want the existing icon system and design tokens reused, so that integration does not add redundant dependencies or an inconsistent icon language.
41. As a maintainer, I want the feature to work in Electron and the plain-browser compatibility surface, so that renderer code does not assume an unavailable bridge.
42. As a release owner, I want the final interaction qualification to exercise real clicks and keyboard input at desktop and mobile widths, so that controls are proven rather than merely present in source.

## Implementation Decisions

- **Ownership remains split by responsibility.** The shell continues to own route navigation, Pi Host status, live-run entry, Electron drag regions and the global navigation collapse state. The task conversation surface continues to own thread-list visibility and mobile drawer behavior. No third sidebar controller is introduced.
- **One automated semantic seam.** Extend the existing pure project-thread grouping projection into the sole sidebar projection seam. It accepts the current thread UI Projection, active project identity, normalized search query and expansion state, then returns ordered visible groups plus truncation/no-results metadata. It performs no I/O, store access, clock reads or mutation.
- **Host authority is unchanged.** Search and expansion are transient presentation state. Thread selection, deletion, fork, rename, project binding and replay-safe rerun continue through existing contracts. Renderer state never becomes a durable session authority, consistent with ADR-0039.
- **Search is title-only in this effort.** Matching conversation bodies, tool output, durable memory or workspace files would combine different search domains and is excluded. Query normalization trims whitespace and compares case-insensitively. Search inspects all otherwise-visible threads rather than only the collapsed first page.
- **Project grouping semantics are preserved.** Active project first, remaining projects by latest thread activity, unbound last, hidden threads excluded, and an empty active project remains renderable. Searching filters threads inside these groups without inventing or renaming project identities.
- **Expansion semantics are explicit.** Outside search, each project uses the existing collapsed limit and a show-more control when required. During a non-empty search, all matching threads are eligible and the global show-more limit does not hide valid matches.
- **Thread rows use native semantics.** Selection is a real button or equivalent native control with selected/current semantics. Nested interactive controls are avoided. Secondary actions live in one overflow menu with delete, fork and replay-safe rerun entries.
- **Action behavior is delegated.** The overflow menu does not duplicate action logic. It invokes the existing action contracts, preserves external-session fork behavior, preserves archive/tombstone deletion, and surfaces existing failures without converting them into silent UI success.
- **Project summary is read-only presentation unless it opens the existing picker.** It never owns a workspace object or a new selected-project field. The composer-adjacent execution context remains authoritative.
- **Diagnostics leave navigation.** Last-run capability and unlocked-tool diagnostics move to an existing run/details surface or a dedicated diagnostics disclosure. Reset behavior remains available there, but long diagnostic content no longer consumes the thread-list footer.
- **No demo dependencies or content.** The reference component is design input only. Fake workspace data, fake recents, Upgrade, Invite users, Sign out, New workspace, Central Icons and GlideMenu are not introduced.
- **One visual language, not one state machine.** Route rows and thread rows share size, icon slot, typography, tonal active state, focus treatment and reduced-motion rules. A small reusable row primitive is allowed only if it stays presentational and does not absorb routing or thread actions.
- **Motion is resilient.** Content is visible by default. Transitions may affect width, tone and icon state but do not start required labels or controls at zero opacity. Hover and active states do not translate or scale controls. Reduced-motion users receive immediate state changes.
- **Material treatment is restrained.** Existing tokens remain the palette. The integration removes excessive radial glows, all-around shadows, hard hairline decoration, repeated pill containers and gliding highlights. Depth, where retained, comes from quiet surface tone and a restrained directional edge.
- **Responsive behavior remains two-mode.** Desktop shows the task conversation sidebar inline when enabled. Small screens use the existing modal drawer and backdrop. Global app navigation collapse remains independent because it represents a different shell-level decision.
- **Traditional Chinese mixed with English remains the copy convention.** Product terms such as project, conversation, thread, Pi Host and replay-safe retain the repository's established vocabulary.
- **No schema or protocol change.** The feature consumes existing project and thread UI Projection fields and adds no Pi Host Protocol, durable store, database or settings fields.

## Testing Decisions

- Good tests assert user-visible behavior and stable domain outputs, not component class names, exact DOM nesting, animation timers or private hook state.
- The primary automated seam is the single pure sidebar projection. Existing project-group fixture coverage is extended rather than creating parallel search and grouping implementations.
- Projection fixtures cover: active project with no conversations; active-first ordering; other projects ordered by recency; unbound-last ordering; hidden thread exclusion; title filtering; case/whitespace normalization; no-results metadata; search across threads beyond the collapsed limit; normal truncation; and expansion restoring the full list.
- Existing thread project grouping smoke is the prior art. Its shipped-module import style remains the model, and the expanded smoke stays on the normal `smoke` and `smoke:ci` gates.
- UI qualification tests external behavior in a built renderer: create a conversation, select a conversation, open/clear search, find an older collapsed conversation, observe no results, open and dismiss the overflow menu, invoke non-destructive fork/replay fixtures, collapse shell navigation, and open/close the mobile drawer.
- Keyboard qualification covers Tab order, Enter/Space row activation, overflow-menu arrow navigation where supported by the chosen primitive, Escape dismissal, focus restoration and visible focus rings.
- Accessibility qualification checks native button/menu semantics, current/selected announcements, accessible names for icon-only controls, contrast, and no pointer-only actions.
- Visual qualification captures expanded and collapsed shell navigation plus task conversation sidebar at desktop and narrow widths, in supported color modes and with reduced motion. It explicitly checks icon centering, clear gutters, no clipped text, no hard shadow boxes, no cut-off glow, and no blank content caused by animation.
- Regression qualification confirms route navigation, Pi Host status, live-run entry, project following on thread selection, hidden-thread exclusion, mobile auto-close, external-session fork and replay-safe checkpoint behavior remain unchanged.
- `npm run build`, the focused sidebar smoke, `npx oxlint src`, and the full `npm run smoke` are required before resolution. A ticket cannot be marked resolved from source inspection alone.

## Out of Scope

- Replacing the global app navigation and task conversation list with one combined ChatGPT-style sidebar.
- Moving route navigation ownership into the task conversation page.
- Creating a new workspace model, project selector state or durable sidebar preference store.
- Searching message bodies, tool results, Turn Record entries, durable memory, knowledge items or workspace files.
- Changing Pi Core Host session persistence, thread archive semantics, project binding, fork contracts or replay-safe checkpoint rules.
- Adding Invite users, team seats, billing, Upgrade, account Sign out or workspace creation capabilities.
- Adding Central Icons, GlideMenu, another icon library or a new motion library solely for this feature.
- Renaming conversations or adding drag-and-drop project organization.
- Redesigning the application header, composer, run timeline, approval UI or other page-level navigation.
- A full new typography system or brand redesign.

## Further Notes

- The reference document is a visual and interaction source, not executable product truth. Its fake data and actions must not survive implementation.
- ADR-0039 applies directly: Pi session state is canonical and renderer Zustand is a disposable UI Projection. Search is therefore a derived view only.
- ADR-0023 also applies: the Electron/React renderer remains the product shell, so this is shell and projection work rather than Pi TUI adoption.
- The anti-slop design law is acceptance input, not decoration. Final review must explicitly check content-visible-by-default, contrast, centering, clear-the-cut, stable hover states, restrained material effects, real controls and removal of demo interactions.
- The skill normally asks for user confirmation of the proposed test seam, but its no-interview rule and this invocation require synthesis from the existing discussion. The single projection seam records the recommended expectation and can be changed through a later spec revision if the maintainer disagrees.

## Tickets

| # | Ticket | Blocked by |
|---|---|---|
| 01 | [Sidebar projection and search contract](issues/01-sidebar-projection-search.md) | — |
| 02 | [Conversation sidebar interactions](issues/02-conversation-sidebar-interactions.md) | 01 |
| 03 | [Shell and conversation visual language](issues/03-sidebar-visual-language.md) | — |
| 04 | [Move run capability diagnostics out of navigation](issues/04-relocate-sidebar-diagnostics.md) | 02 |
| 05 | [Responsive accessibility and qualification](issues/05-sidebar-qualification.md) | 01–04 |
