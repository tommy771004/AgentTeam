# 07 — Spill large tool output instead of truncating it

**What to build:** When a tool result exceeds the supervisor's payload limit, store it and return a locator plus retrieval instructions rather than cutting the payload off.

**Blocked by:** None.

**Status:** 可交給代理

`agent/supervisor.ts` enforces payload byte limits and round budgets, and its only disposal for an over-limit result is truncation. The information is lost and the model cannot ask for the rest. Spilling to storage costs fewer tokens than a large inline payload and loses nothing.

`electron/attachmentStore.ts` already exists as the storage destination.

- [ ] Over-limit tool results are written to `electron/attachmentStore.ts` and replaced with a locator plus instructions for retrieving specific parts.
- [ ] The model can retrieve a bounded region of a spilled result; retrieval itself is subject to the same limits and cannot be used to reassemble the whole payload in one round.
- [ ] Byte limits and round budgets are unchanged; only the disposal of over-limit payloads changes.
- [ ] Halt behaviour is unchanged — spilling does not become a way to bypass the round budget.
- [ ] Spilled content is scoped to its run and is not readable from another run or thread.
- [ ] Spilled payloads pass through the same outbound gate and sanitisation as inline results before reaching a provider.
- [ ] Spill records are cleaned up on run settlement or bounded by a retention limit.
- [ ] Supervisor smoke covers the spill path; a manual large-output case confirms a locator is returned and the content is retrievable.

Files: `app/src/agent/supervisor.ts`, `app/electron/attachmentStore.ts`, `app/scripts/smoke.mjs`.
