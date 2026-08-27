# 05 — Responsive accessibility and qualification

Status: 可交給代理
Spec: `.scratch/sidebar-navigation-integration/spec.md`

## What to build

Qualify the integrated sidebar as a shipped user flow in the built renderer. Exercise desktop expanded/collapsed navigation, inline conversation list, mobile drawer, title search, no-results, show-more, thread selection, new conversation and the overflow menu using real pointer and keyboard interaction.

Capture visual evidence at desktop and narrow widths and run a complete anti-slop review. Confirm clear gutters, centered icons, content-visible-by-default, readable contrast, no clipped controls, stable hover states, restrained material effects and no dead demo controls. Verify Electron-specific drag regions and plain-browser feature detection remain safe.

## Acceptance criteria

- [ ] Desktop shell collapse and expansion work without changing route ownership
- [ ] Conversation search finds a thread beyond the collapsed limit
- [ ] Clear, Escape and no-results behaviors work through real interaction
- [ ] Selecting a result follows its project and opens the correct conversation
- [ ] New conversation uses the existing creation path
- [ ] Overflow menu works by pointer and keyboard and restores focus
- [ ] Mobile drawer opens, closes via backdrop/control, and auto-closes after selection
- [ ] Current route and selected conversation are announced semantically
- [ ] Every icon-only control has an accessible name and visible focus treatment
- [ ] Screenshots cover desktop expanded, desktop collapsed and narrow drawer states
- [ ] Visual review finds no clipped content, centering miss, hard shadow box, cut-off glow, hover boop, unreadable text or opacity-gated content
- [ ] No fake workspace/actions or new sidebar authority appears in the shipped UI
- [ ] Focused sidebar smoke, `npm run build`, `npx oxlint src` and full `npm run smoke` pass
- [ ] Evidence and exact gate results are appended before any ticket is marked resolved

## Blocked by

01–04.
