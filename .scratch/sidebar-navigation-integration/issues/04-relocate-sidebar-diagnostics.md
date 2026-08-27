# 04 — Move run capability diagnostics out of navigation

Status: 可交給代理
Spec: `.scratch/sidebar-navigation-integration/spec.md`

## What to build

Remove the last-run capability and unlocked-tool diagnostic block from the conversation navigation footer. Place the same read-only information and reset action in an existing run/details surface or a dedicated diagnostics disclosure associated with the active conversation.

The move must preserve provenance labels and reset behavior. It must not create another capability state owner or change cross-run restore semantics. The conversation sidebar footer should contain only navigation-relevant status or controls after the move.

## Acceptance criteria

- [ ] Long capability/tool diagnostics no longer consume conversation navigation space
- [ ] Active conversation diagnostics remain reachable from a run/details surface
- [ ] Capability and unlocked-tool provenance remains visible
- [ ] Reset uses the existing action and affects the same active conversation
- [ ] No duplicate capability state is introduced
- [ ] Empty diagnostic state remains honest and readable
- [ ] `npm run build` and the relevant existing capability smoke pass

## Blocked by

02 — Conversation sidebar interactions.
