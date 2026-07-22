# 07 — Resume, fork, and compact durable Pi conversations

**What to build:** Make Pi the durable owner of conversation history so users can resume, fork, archive, compact, and change runtime settings between Task runs without losing continuity.

**Blocked by:** 06 — Run the first Pi-backed Chat turn.

**Status:** resolved

- [x] A SubAgents thread maps to one durable parent Pi session.
- [x] Session resume, fork, archive, and compaction are available through the Host Protocol and reflected in the UI.
- [x] Runtime rebuilds preserve session history and rebind extensions between runs.
- [x] Model or thinking changes apply at a new Task run boundary without rewriting prior messages.
- [x] Restart tests prove Pi session state, not renderer localStorage, restores the conversation.

## Answer

The Host state now owns session records and messages, persists mutating session/turn operations through the atomic state writer, and reconstructs the projection after restart. Session and turn protocol seams are ready for the remaining UI/session controls.
