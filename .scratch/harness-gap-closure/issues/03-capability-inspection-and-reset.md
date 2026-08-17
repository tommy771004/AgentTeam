# 03 — Show and reset a thread's unlocked capabilities

**What to build:** Expose the capabilities and tools a thread currently has unlocked, and give the user a control to reset that state.

**Blocked by:** None.

**Status:** 可交給代理

Progressive disclosure persists correctly and invisibly. `state.loadedCapabilityIds` is preloaded each step; after a run, ids and `unlockedToolNames` are stored on the thread as `lastCapabilityIds` / `lastUnlockedTools` and re-injected on the next dispatch. The mechanism is right, but the user cannot see what is unlocked and cannot lock anything back, so a capability unlocked by mistake is undiagnosable and permanent for the life of the thread.

This reads data that already exists. No new persistence layer.

- [ ] The thread sidebar lists the capabilities currently loaded for that thread and the tools currently unlocked.
- [ ] Entries distinguish how each was unlocked: preloaded, `load_capability`, or `tool_search`.
- [ ] A reset control clears `lastCapabilityIds` and `lastUnlockedTools` for the thread.
- [ ] After a reset, the next run starts from the deferred catalog with no preloaded ids or unlocked tool names.
- [ ] Skill (`skill:<name>`) and MCP (`mcp:<serverId>`) capabilities generated at assemble time appear in the list with their generated identity.
- [ ] Resetting one thread does not affect any other thread.
- [ ] Behaviour confirmed manually under `npm run dev`; the reset path is covered by a capability smoke.

Files: `app/src/agent/capabilities/runtime.ts`, thread sidebar component, `app/scripts/smoke-caps.mjs`.
