# 07 — Spill large tool output instead of truncating it

**What to build:** When a tool result exceeds the supervisor's payload limit, store it and return a locator plus retrieval instructions rather than cutting the payload off.

**Blocked by:** None.

**Status:** resolved

`agent/supervisor.ts` enforces payload byte limits and round budgets, and its only disposal for an over-limit result is truncation. The information is lost and the model cannot ask for the rest. Spilling to storage costs fewer tokens than a large inline payload and loses nothing.

`electron/attachmentStore.ts` already exists as the storage destination.

- [x] Over-limit tool results are written to `electron/attachmentStore.ts` and replaced with a locator plus instructions for retrieving specific parts.
- [x] The model can retrieve a bounded region of a spilled result; retrieval itself is subject to the same limits and cannot be used to reassemble the whole payload in one round.
- [x] Byte limits and round budgets are unchanged; only the disposal of over-limit payloads changes.
- [x] Halt behaviour is unchanged — spilling does not become a way to bypass the round budget.
- [x] Spilled content is scoped to its run and is not readable from another run or thread.
- [x] Spilled payloads pass through the same outbound gate and sanitisation as inline results before reaching a provider.
- [x] Spill records are cleaned up on run settlement or bounded by a retention limit.
- [x] Pi Host smoke covers the spill path and confirms a locator is returned, bounded content is retrievable, and cross-run retrieval is denied.

Files: `app/electron/attachmentStore.ts`, `app/electron/piExtensionPacks/utility.ts`, `app/src/agent/taskRunCoordinator.ts`, `app/scripts/smoke-pi-bash-stream-cancel.mts`.

## Resolution evidence (2026-08-31)

Pi Core Host is now the canonical builtin tool-loop owner, so the old `agent/supervisor.ts` anchor no longer exists. Oversized bash output returns a run-scoped `toolspill:` locator; `tool_output_read` pages it with bounded reads, settlement disposes the run directory, and `attachmentStore` also caps retained spill files. `smoke-pi-bash-stream-cancel.mts` exercises spill, retrieval, and cross-run denial through the shipped Host pack.
