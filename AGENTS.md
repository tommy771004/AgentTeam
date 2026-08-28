# AGENTS.md

Guidance for Codex here. **`CLAUDE.md` is the canonical version — read it first.** This file only repeats the rules whose violation breaks the build or the security model, so the two cannot drift.

The product is `app/` (Electron + React 19 + TypeScript + Vite + zustand); everything else at the root is design input, and `CONTEXT.md` is the domain language. There is **no in-repo `RTK.md`**. UI copy, logs, and some comments are Traditional Chinese mixed with English — keep that style.

Commands, all from `app/`: `npm run dev`, `npm run build` (this is the typecheck), `npm run smoke`, `npx oxlint src`, `npm run dist:mac`.

- Every run enters through `agent/taskRunCoordinator.ts` `runTask`. **Never call `dispatchThreadTask` or `startExecution` from UI code** — a drift guard fails the build.
- Different conversation threads execute independently up to `maxConcurrentRuns`; same-thread follow-ups remain ordered. `agentStore.isRunning` is derived from the run registry rather than being a sole lock (ADR-0003).
- **Time-based** requires a claimed `ScheduledJob` trigger snapshot and **Proactive** requires event matcher evidence, both asserted fail-closed at admission. Cron/event wording in chat produces a suggestion, never a run.
- Runner capability matrix: builtin is `executionKind: 'loop'` with parse/DoD/iterate/continueGoal; external CLI is `'external'` with parse/DoD/iterate false. Its `continueGoal` exists only through the explicit prompt contract in `runners/types.ts`, and CLI success is never DoD met.
- Pi Core in the supervised Electron utility process owns the tool loop, execution, approvals, and settlement. `agent/loop/` is a removable browser-compatibility seam — add no imports or references to it (ADR-0045).
- Connector tokens live only in the main-process encrypted vault; no renderer path may read raw tokens. Renderer code must feature-detect `window.subagents?.x`.
- Smokes import the shipped modules and many are drift guards over source text. Never re-implement logic inline to make one pass; repoint a guard at the new owner instead of weakening it.
