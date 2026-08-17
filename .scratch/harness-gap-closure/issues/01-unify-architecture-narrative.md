# 01 — Unify the architecture narrative and declare the legacy loop's exit

**What to build:** Make `CLAUDE.md` and `CONTEXT.md` describe one runtime, with the legacy `agent/loop` path marked as an explicitly transitional seam, and add a drift guard so new references to it cannot accumulate.

**Blocked by:** None.

**Status:** 可交給代理

Take this ticket first. It determines where the code from every other ticket belongs.

The two documents currently disagree. `CLAUDE.md` describes `agent/loop` + `agent/engine.ts` + a renderer tool loop; `CONTEXT.md` describes Pi Core as the sole tool-loop owner with SubAgents as an Orchestration Extension. Both paths exist in code — `registry.ts` `selectToolsForStep` branches on `electronPiHostOwnsTools` to skip `bash` with a comment naming Pi Host as the canonical Bash owner, alongside 30+ `electron/pi*.ts` files and 40+ `smoke-pi-*` scripts. ADR-0045 already chose removable compatibility seams; what is missing is the exit timetable and document alignment.

- [ ] `CLAUDE.md` and `CONTEXT.md` describe the same target runtime, with the legacy loop named as a transitional path rather than the architecture.
- [ ] Each surviving compatibility seam names its deletion gate, per ADR-0045.
- [ ] Behavioural divergence between the two `bash` paths (browser fallback versus Pi Host) is documented or removed, not left implicit.
- [ ] A drift guard fails the build when a new source file adds a reference to `agent/loop/*` beyond the existing allowlist.
- [ ] Deliberately introducing one new `agent/loop/*` reference makes `npm run smoke` fail.
- [ ] The existing "`agent/loop` is only imported by `engine.ts`" guard in `smoke-caps.mjs` still passes against both the fixture and the real file tree.

Files: `CLAUDE.md`, `CONTEXT.md`, `app/scripts/smoke-loop-parity.mts`, `app/scripts/smoke-caps.mjs`, `app/src/agent/tools/registry.ts`.
