# 04 — Acceptance Gate 首條完整路徑

**What to build:** 讓 turn answer 與 file-content criteria 經 Host-owned checker、trusted evidence、AcceptanceSnapshot 到 terminal Goal outcome 完成第一條 acceptance-driven vertical slice。

**Blocked by:** 03 — Goal Contract admission 與 fail-closed.

**Status:** resolved

- [x] assistant-answer-present 僅適用 turn mode，answered 與 Goal passed 不再隱式等價。
- [x] file-content criterion 以 immutable content digest evidence 驗證，後續內容漂移會 invalidated。
- [x] 每次 check 產生 immutable AcceptanceSnapshot，passed 必須引用 acceptance digest。
- [x] Model 自稱完成但 checker failed 時不得產生 passed verdict。

## Qualification

- `npm run smoke:acceptance-gate` — verifies Turn-only answer acceptance, immutable/tamper-detectable evidence and snapshot digests, trusted file SHA-256, and drift invalidation.
- `npm run smoke:goal-contract` — exercises the shipped Pi Host: missing file plus model completion text cannot pass; matching file content produces `passed` with an exact `goal-verdict.acceptanceDigest` reference.
- `node --experimental-strip-types scripts/smoke-pi-turn-record.mts`
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts`
- `node --experimental-strip-types scripts/smoke-pi-working-state-completion.mts`
- `node --experimental-strip-types scripts/smoke-run-lifecycle.mts`
- `node --experimental-strip-types scripts/smoke-prod-modules.mts` (37 passed)
- `npm run build`
- targeted `oxlint` on changed production and smoke modules
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- `git diff --check`
