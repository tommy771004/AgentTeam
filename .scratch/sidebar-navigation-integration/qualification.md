# Sidebar navigation integration qualification

Date: 2026-08-27  
Qualified commit: `f5a589b` (with implementation commit `2988240`)  
Result: PASS

## Automated gates

- `npm run build`: PASS in a detached clean worktree at `f5a589b`. The pinned Pi vendor artifacts were reused through the repository's normal `.cache/pi-vendor-build.json` contract so the run did not consume the temporally drifting public model catalog.
- `npx tsc -b`: PASS.
- `npx vite build`: PASS for renderer, Electron main and preload bundles.
- `npx oxlint src`: PASS with 12 pre-existing warnings outside the sidebar scope and zero errors.
- `node --experimental-strip-types scripts/smoke-thread-project-groups.mts`: PASS. Output: `thread project groups smoke: grouping, hidden exclusion, search, truncation, empty results`.
- `node --experimental-strip-types scripts/smoke-composer-approval-handoff.mts`: PASS, including the real responsive Protocols page fixture.
- `npm run smoke`: PASS in the same detached clean worktree. The final Electron Pi Core Host renderer reattach E2E passed two active and two terminal cases and Electron exited with code 0.

The first main-worktree smoke exposed a fixture that queried an old explicit `[role="button"]`. The shipped row is now a native `<button>`, so the guard was repointed to `button.sidebar-thread-select` instead of adding a redundant role. A later main-worktree run reached an unrelated uncommitted Working State protocol 5/4 mismatch; the clean-worktree run above isolated the sidebar commit and passed the complete chain.

## Built-renderer interaction evidence

The production renderer was built and opened through the in-app browser at 1280×820 and 600×820.

- Desktop shell navigation collapsed and expanded while retaining the shell-owned route state and Pi Core status.
- Search opened with focus in the input, filtered titles immediately, showed a truthful no-results message, cleared in one action and closed with Escape.
- Project grouping remained visible during search; the active project retained an explicit empty-match row.
- Native conversation buttons exposed `aria-current="page"` for the selected conversation.
- The Radix overflow menu exposed three menuitems: 建立分支, 從 checkpoint 重跑 and 刪除對話.
- Keyboard sequence was verified directly: first ArrowDown focused item 1, second ArrowDown focused item 2, ArrowUp returned to item 1, and Escape restored focus to the trigger.
- Pointer dismissal outside the menu closed it and restored focus to the trigger.
- At narrow width the drawer and backdrop stayed inside the product shell, the close control worked, and selecting a conversation closed the drawer.
- Desktop expanded, desktop collapsed and narrow drawer captures were visually inspected during qualification.

## Code-review closure

Two parallel reviews were run from fixed point `89fb7c4`: Standards and Spec. All findings were closed.

- Replaced the hand-rolled action menu and focus management with Radix Dropdown Menu.
- Moved provider-aware fork and replay delegation out of `ThreadSidebar` into `useThreadConversationActions`.
- Preserved active-project context during unmatched search.
- Split `parsing` and `running` into honest semantic labels rather than announcing both as running.
- Repointed the brittle component fixture to the native-button owner.

## Anti-slop point-by-point recheck

- Content remains visible by default; no required label or control starts at opacity zero or waits for an entrance animation.
- Rows and controls never translate or scale on hover or press. Reduced-motion removes non-essential transitions.
- No fake workspace, fake recents, Upgrade, Invite, Sign out, New workspace or dead control was introduced.
- Real product data populates the sidebar; shell routes and conversation actions keep separate, existing owners.
- No blue-purple gradient, radial halo, cut-off glow, floating card, gliding highlight, status-pill field or fake shadow box was added.
- The decorative sidebar edge hairline was removed. Remaining borders are structural; shadows are tight and directional.
- Icon-only controls have accessible names, visible focus treatment and verified optical centering in expanded, collapsed and narrow layouts.
- Text keeps deliberate gutters, readable tonal contrast and remains fully inside clipped/fixed regions. The mobile drawer no longer sits behind the shell rail.
- The menu uses a maintained accessible primitive; no nested interactive elements or pointer-only actions remain.
- Active route and active conversation state are typographic/tonal and semantic, without decorative dots or animated underlines.
- The UI reuses the product's existing icon system and design tokens. The only dependency added is the behavior primitive required to replace custom menu mechanics.

