# 07 — Resume, fork, and compact durable Pi conversations

**What to build:** Make Pi the durable owner of conversation history so users can resume, fork, archive, compact, and change runtime settings between Task runs without losing continuity.

**Blocked by:** 06 — Run the first Pi-backed Chat turn.

**Status:** 可交給代理

- [ ] A SubAgents thread maps to one durable parent Pi session.
- [ ] Session resume, fork, archive, and compaction are available through the Host Protocol and reflected in the UI.
- [ ] Runtime rebuilds preserve session history and rebind extensions between runs.
- [ ] Model or thinking changes apply at a new Task run boundary without rewriting prior messages.
- [ ] Restart tests prove Pi session state, not renderer localStorage, restores the conversation.
