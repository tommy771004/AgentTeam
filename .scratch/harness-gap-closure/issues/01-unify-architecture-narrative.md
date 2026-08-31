# 01 — Unify the architecture narrative and declare the legacy loop's exit

**What to build:** Make `CLAUDE.md` and `CONTEXT.md` describe one runtime, with the legacy `agent/loop` path marked as an explicitly transitional seam, and add a drift guard so new references to it cannot accumulate.

**Blocked by:** None.

**Status:** resolved

Take this ticket first. It determines where the code from every other ticket belongs.

The two documents currently disagree. `CLAUDE.md` describes `agent/loop` + `agent/engine.ts` + a renderer tool loop; `CONTEXT.md` describes Pi Core as the sole tool-loop owner with SubAgents as an Orchestration Extension. Both paths exist in code — `registry.ts` `selectToolsForStep` branches on `electronPiHostOwnsTools` to skip `bash` with a comment naming Pi Host as the canonical Bash owner, alongside 30+ `electron/pi*.ts` files and 40+ `smoke-pi-*` scripts. ADR-0045 already chose removable compatibility seams; what is missing is the exit timetable and document alignment.

- [x] `CLAUDE.md`, `CONTEXT.md` and the conversation-flow document describe Pi Core Host as the sole builtin tool-loop owner.
- [x] The transitional `agent/loop/` and `agent/engine.ts` seams reached their ADR-0045 deletion gate and were removed.
- [x] The browser fallback `bash` path was removed; Pi Host adapters are the single builtin shell owner.
- [x] A drift guard fails the build when a new source file references or imports the deleted `agent/loop/*`／`agent/engine.ts` path.
- [x] Deliberately introducing one new legacy reference makes the guard fail.
- [x] The old allowlist guard was replaced by the stronger zero-reference fixture + real-tree guard in `smoke-caps.mjs`.

Files: `CLAUDE.md`, `CONTEXT.md`, `docs/CONVERSATION_LOOP_HERMES_FLOW.md`, `app/scripts/smoke-caps.mjs`, `app/scripts/smoke-runner-contract.mts`.

## Resolution evidence (2026-08-31)

The migration advanced beyond this ticket's transitional target: the legacy engine and loop no longer exist. `smoke-caps.mjs` checks both hostile fixtures and the real tree, while runner-era assertions were repointed to current owners in `smoke-runner-contract.mts`. The conversation architecture document now names `runTask`, `runDispatch` and Pi Host rather than deleted owners or forced-Goal semantics.
