# 04 — Write drafted skills and memory into the project

**What to build:** Add a path that writes learning-loop output to `<project>/.subagents/skills/<name>/SKILL.md` and equivalent memory files, so the products of successful runs can be reviewed, committed, and shared.

**Blocked by:** None.

**Status:** 可交給代理

`hermes/learning.ts` drafts skills from successful runs, `hermes/dream.ts` consolidates memory, and `knowledge.ts` extracts entities — and every product stays in local browser storage. It cannot be committed, shared, or reviewed. The learning loop has no exit.

`electron/projectBridge.ts` already resolves the project root by walking up at most three levels and stopping at `.git`. Reuse it. Do not write new path resolution.

- [ ] Drafted skills can be exported to `<project>/.subagents/skills/<name>/SKILL.md`.
- [ ] Consolidated memory and extracted entities have an equivalent file destination under `<project>/.subagents/`.
- [ ] The project root is resolved through `electron/projectBridge.ts`; no new root-detection logic is added.
- [ ] Export is an explicit user action from the Learning page, not an automatic side effect of a successful run.
- [ ] Written paths cannot escape the resolved project root — traversal, absolute paths, and symlink escapes are all refused.
- [ ] Exporting an existing skill name does not silently overwrite; the user chooses.
- [ ] Written files are valid `SKILL.md` playbooks that `hermes/skills.ts` can load back.
- [ ] A new smoke asserts the write path stays within the project root, following the path assertions in `smoke-sanitized-workspace.mts`.

Files: `app/src/agent/hermes/skills.ts`, `app/src/agent/hermes/learning.ts`, `app/src/agent/hermes/dream.ts`, `app/src/agent/knowledge.ts`, `app/electron/projectBridge.ts`, `app/src/pages/LearningPage.tsx`.
