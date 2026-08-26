# 06 — Add `workspace_grep` and `workspace_glob`

**What to build:** Give the agent pattern search and glob over the project, and correct the stale tool-registration instructions in `CLAUDE.md` at the same time.

**Blocked by:** None.

**Status:** resolved（superseded）

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

## Comments

> 對帳註記（2026-08-26，workspace-text-search effort 發布時）：本票寫於 remove-legacy-engine 合併前，其實作處方已與現實衝突——`tools/registered/` 是凍結 seam（`check-pi-contract.mts` 對新檔案即失敗），「新增自註冊模組」不再可行。且本票描述的能力大半已以不同形狀存在：`toolDefinitions.ts` 已有 `workspace_grep` / `workspace_glob` 定義、`electron/workspaceFs.ts` 有搜尋 helper（含 `--no-config` 前綴）、main.ts 有 IPC、`smoke-workspace-search.mts` 在鏈上。真正缺口是 **Pi Host 生產路徑的工具面與治理開關**——由新 effort `.scratch/workspace-text-search/`（4 票）承接。本票最終下場（resolved／superseded）待該 effort 收口時一併對帳。

> 收口註記（2026-08-26）：由 `workspace-text-search` effort 以 Pi Host Extension Pack 等價完成，未修改凍結 renderer seam。證據為 `npm run smoke:workspace-text-search` 19/19、`npm run build`、完整 `npm run smoke` 全綠；原處方因架構已淘汰，故本票以 superseded 收口。
