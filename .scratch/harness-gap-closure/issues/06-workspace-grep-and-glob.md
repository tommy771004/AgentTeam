# 06 — Add `workspace_grep` and `workspace_glob`

**What to build:** Give the agent pattern search and glob over the project, and correct the stale tool-registration instructions in `CLAUDE.md` at the same time.

**Blocked by:** None.

**Status:** 可交給代理

The tool catalog has `codegraph_*` structural tools plus `workspace_read` and `workspace_diff`, and no grep, no glob, and no LSP. Grep and glob are the highest-frequency tool family for a coding agent, and their absence forces every search through a structural graph that was not built for it.

Follow the **current** registration model, not the one `CLAUDE.md` documents. The central `executeTool` switch was deliberately deleted and `tools/executor.ts` is now a fifteen-line compat shim; 48 self-registering modules under `tools/registered/*.ts` carry the implementations, and `tools/toolDefinitions.ts` is the single source of truth where each tool declares `owningCapability` (an orphan tool fails the `satisfies` check at compile time). `registry.ts` and `schemas.ts` are derived views — do not hand-edit them, and do not add a switch case to `executor.ts`.

- [ ] `workspace_grep` and `workspace_glob` are defined in `tools/toolDefinitions.ts` with `owningCapability: 'workspace'`.
- [ ] Handlers self-register from `tools/registered/workspaceGrep.ts` and `tools/registered/workspaceGlob.ts`.
- [ ] IPC is added to `electron/workspaceFs.ts`, with a browser fallback so the renderer feature-detects rather than assuming Electron.
- [ ] Results are scoped to the resolved project and cannot read outside it.
- [ ] Result size is bounded and interacts correctly with `agent/supervisor.ts` limits.
- [ ] If a bundled ripgrep binary is used, argv is prefixed with `--no-config` so `RIPGREP_CONFIG_PATH` cannot inject `--pre` and alter execution.
- [ ] `npm run smoke:tool-registry` finds no orphan; `smoke-tool-invocation.mts` covers invocation; the `smoke-caps.mjs` guard requiring every registry tool to be read-only or classified passes.
- [ ] The "Adding a tool touches `registry.ts` / `schemas.ts` / `executor.ts` / `builtins.ts`" paragraph in `CLAUDE.md` is corrected to the current model.

Files: `app/src/agent/tools/toolDefinitions.ts`, `app/src/agent/tools/registered/`, `app/electron/workspaceFs.ts`, `CLAUDE.md`.
