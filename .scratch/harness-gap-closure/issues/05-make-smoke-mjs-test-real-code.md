# 05 — Make `smoke.mjs` test the shipped code

**What to build:** Replace the inline re-implementations in `scripts/smoke.mjs` with imports of the real modules, so its green result means the shipped code is correct.

**Blocked by:** None.

**Status:** 可交給代理

`scripts/smoke.mjs` declares the problem in its own header: "Minimal re-implementations mirrored from source for CI without TS build". It inlines `computeNextRun` and the other logic it claims to cover, so it validates an algorithm's shape rather than the code path that ships. Scheduler maths, supervisor truncation, and loop classification are currently false green lights.

`smoke-caps.mjs` does not have this problem — it imports real modules — and the `.mts` plus `--experimental-strip-types` pattern is already used by dozens of `smoke-*.mts` scripts. This is a port, not a design task.

- [ ] `computeNextRun` assertions import `agent/scheduler.ts` rather than an inline copy.
- [ ] Supervisor truncation and halt assertions import `agent/supervisor.ts`.
- [ ] `classifyLoopType` assertions import `agent/parser.ts`.
- [ ] Event-matching assertions import `agent/eventMatcher.ts`.
- [ ] Every inline mirror is deleted, not left beside the import.
- [ ] `npm run smoke` and `npm run smoke:ci` are fully green after the change.
- [ ] Falsification, recorded in the ticket: deliberately breaking `computeNextRun` passes the pre-change suite and fails the post-change suite. Repeat for supervisor truncation, `classifyLoopType`, and `eventMatcher`.

Files: `app/scripts/smoke.mjs`, `app/src/agent/scheduler.ts`, `app/src/agent/supervisor.ts`, `app/src/agent/parser.ts`, `app/src/agent/eventMatcher.ts`.
