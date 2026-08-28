# 04 — Write drafted skills and memory into the project

**What to build:** Add a path that writes learning-loop output to `<project>/.subagents/skills/<name>/SKILL.md` and equivalent memory files, so the products of successful runs can be reviewed, committed, and shared.

**Blocked by:** None.

**Status:** resolved

`hermes/learning.ts` drafts skills from successful runs, `hermes/dream.ts` consolidates memory, and `knowledge.ts` extracts entities — and every product stays in local browser storage. It cannot be committed, shared, or reviewed. The learning loop has no exit.

`electron/projectBridge.ts` already resolves the project root by walking up at most three levels and stopping at `.git`. Reuse it. Do not write new path resolution.

- [x] Drafted skills can be exported to `<project>/.subagents/skills/<name>/SKILL.md`.
- [x] Consolidated memory and extracted entities have an equivalent file destination under `<project>/.subagents/`.
- [x] The project root is resolved through `electron/projectBridge.ts`; no new root-detection logic is added.
- [x] Export is an explicit user action from the Learning page, not an automatic side effect of a successful run.
- [x] Written paths cannot escape the resolved project root — traversal, absolute paths, and symlink escapes are all refused.
- [x] Exporting an existing skill name does not silently overwrite; the user chooses.
- [x] Written files are valid `SKILL.md` playbooks that `hermes/skills.ts` can load back.
- [x] A new smoke asserts the write path stays within the project root, following the path assertions in `smoke-sanitized-workspace.mts`.

Files: `app/src/agent/hermes/skills.ts`, `app/src/agent/hermes/learning.ts`, `app/src/agent/hermes/dream.ts`, `app/src/agent/knowledge.ts`, `app/electron/projectBridge.ts`, `app/src/pages/LearningPage.tsx`.

## Comments

- 2026-08-28 tracker reconciliation: project-relative learning export、confinement 與 round-trip 由 `smoke-learning-export.mts` 及完整 smoke 主鏈驗證。

**2026-08-17.** The required path smoke found a real hole: the write handler
resolved paths with `path.resolve` + a lexical inside-root check, which accepts
a symlinked directory inside the project that points outside it. Confinement
moved into `electron/learningExportWrite.ts` and now resolves through
`fs.realpathSync` on the deepest existing ancestor. `smoke-learning-export.mts`
covers traversal, absolute paths and the symlink escape against a real
temporary project, and asserts no refused attempt leaves a file behind;
reverting to the lexical check makes it fail.
