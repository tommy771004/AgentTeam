# 05 — Make `smoke.mjs` test the shipped code

**What to build:** Replace the inline re-implementations in `scripts/smoke.mjs` with imports of the real modules, so its green result means the shipped code is correct.

**Blocked by:** None.

**Status:** resolved

`scripts/smoke.mjs` declares the problem in its own header: "Minimal re-implementations mirrored from source for CI without TS build". It inlines `computeNextRun` and the other logic it claims to cover, so it validates an algorithm's shape rather than the code path that ships. Scheduler maths, supervisor truncation, and loop classification are currently false green lights.

`smoke-caps.mjs` does not have this problem — it imports real modules — and the `.mts` plus `--experimental-strip-types` pattern is already used by dozens of `smoke-*.mts` scripts. This is a port, not a design task.

- [x] `computeNextRun` assertions import `agent/scheduler.ts` rather than an inline copy.
- [x] Supervisor truncation and halt assertions import `agent/supervisor.ts`.
- [x] `classifyLoopType` assertions import `agent/parser.ts`.
- [x] Event-matching assertions import `agent/eventMatcher.ts`.
- [x] Every inline mirror is deleted, not left beside the import.
- [x] `npm run smoke` and `npm run smoke:ci` are fully green after the change.
- [x] Falsification, recorded in the ticket: deliberately breaking `computeNextRun` passes the pre-change suite and fails the post-change suite. Repeat for supervisor truncation, `classifyLoopType`, and `eventMatcher`.

Files: `app/scripts/smoke.mjs`, `app/src/agent/scheduler.ts`, `app/src/agent/supervisor.ts`, `app/src/agent/parser.ts`, `app/src/agent/eventMatcher.ts`.

## Comments

- 2026-08-28 tracker reconciliation: smoke 已匯入 shipped modules；主鏈 smoke 及 falsification guards 通過，不再保留 inline mirror。

**2026-08-17 — falsification recorded (spec line 97).** `scripts/smoke.mjs` now
re-execs itself with `--experimental-strip-types` and imports `scheduler.ts`,
`supervisor.ts`, `parser.ts` and `eventMatcher.ts`; the inline mirrors are
deleted, not left alongside.

Verified by deliberately breaking each covered path and confirming the suite
fails (each was reverted immediately after):

| Break | Result |
| --- | --- |
| `computeNextRun` interval `mins * 60_000` → `mins * 120_000` | ✗ fails (10 passed) |
| `enforceToolPayload` shrink loop disabled | ✗ fails (11 passed) |
| `eventMatcher` `hasAttachment` predicate removed | ✗ fails (10 passed) |
| `classifyLoopType` forced to `'Turn-based'` | ✗ fails (8 passed) |
| unmodified | ✓ 12 passed |

The first attempt at the supervisor break (changing only the initial
proportional estimate) still passed, because the shrink loop corrects it. The
assertion was strengthened accordingly: the byte bound is now asserted on the
truncated body with the annotation stripped, plus a dense-prefix fixture whose
first estimate lands at 184 bytes so the loop is the only thing holding the
bound. The earlier `r.output.length < big.length` check would have passed a
truncator returning 9,999 bytes.
