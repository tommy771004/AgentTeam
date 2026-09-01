# 07 — Goal lifecycle persistence 與 exactly-once finalization

**What to build:** 讓 terminal Goal facts 穿越 attachment、journal、reload 與 app finalization recovery，同時保持 Goal truth 與 exactly-once app effects 各自獨立。

**Blocked by:** 06 — Criterion-driven repair loop.

**Status:** resolved

- [x] Terminal attachment 保存 execution settlement、Goal verdict、contract digest 與 acceptance digest。
- [x] Finalization claim、complete、ack 不可改寫 Host 已簽發的 Goal truth。
- [x] Execution terminal 後、app finalization 前 crash 可恢復且 app effects 僅執行一次。
- [x] Legacy journal 採保守 mapping，缺少 DoD proof 時顯示 legacy-unverified。

## Qualification

- `npm run smoke:goal-finalization` — immutable Host terminal facts survive attachment reload and finalization CAS; Run Journal v2 persists Goal digests; v1 loop success without DoD proof remains `legacy-unverified` and external success maps to `not-applicable`.
- `node --experimental-strip-types scripts/smoke-finalize-idempotency.mts` — 9 exactly-once/CAS/recovery checks passed, including claim losers and delayed recovered finalization.
- `node --experimental-strip-types scripts/smoke-run-journal.mts`
- `node --experimental-strip-types scripts/smoke-run-journal-durability.mts`
- `node --experimental-strip-types scripts/smoke-reattach-reconcile.mts`
- `npm run smoke:goal-contract`
- `node --experimental-strip-types scripts/smoke-pi-host-supervisor.mts`
- `node --experimental-strip-types scripts/smoke-prod-modules.mts` (37 passed)
- `npm run build`
- targeted `oxlint` on changed production and smoke modules
- `git diff --check`
