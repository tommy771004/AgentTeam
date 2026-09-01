# 02 — 擴充正交 Outcome vocabulary

**What to build:** 讓 execution settlement、Goal verdict、turn settlement 與 app finalization 成為可同時表達的正交事實，所有 presentation surface 使用同一保守推導。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] answered 可與 failed、unverifiable 或 exhausted Goal verdict 同時存在。
- [x] Child actor execution completed 不會使 parent Goal passed。
- [x] legacy-unverified 僅作 migration projection，新的 canonical GoalVerdict 不簽發它。
- [x] UI、journal 與 archive 使用同一 outcome derivation contract。

## Qualification

- `node scripts/smoke-run-lifecycle.mts`
- `node scripts/smoke-run-journal.mts`
- `node scripts/smoke-agent-tree-read-model.mts`
- `npm run smoke:run-status-surface`
- `node scripts/smoke-pi-host-queue-settlement.mts`
- `node scripts/smoke-pi-turn-settlement-union.mts`
- `node scripts/smoke-pi-turn-success.mts`
- `node scripts/smoke-run-operations-projection.mts`
- `node scripts/smoke-prod-modules.mts` (37 passed)
- `npm run build`
- targeted `oxlint` on changed production modules
- `npm run check:unused-production`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- `git diff --check`

Known unrelated repository gate: `npm run check:pi-contract` remains blocked because tracked `scripts/smoke-permission-ask-panel.mjs` is not wired to an npm smoke gate; this predates and is outside ticket #02.
