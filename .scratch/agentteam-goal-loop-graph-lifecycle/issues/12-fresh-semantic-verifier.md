# 12 — Fresh semantic verifier

**What to build:** 讓 semantic criteria 由獨立 fresh-context verifier 驗證，僅讀取受政策約束的 artifacts、criteria、evidence refs 與 rubric。

**Blocked by:** 05 — 擴充 deterministic criteria; 10 — Fan-out／fan-in scheduler.

**Status:** resolved

- [x] Verifier request 不含 worker transcript、provider history 或 reasoning。
- [x] Sanitized artifact projection 仍經 Outbound Data Gate，fresh context 不繞過 policy。
- [x] Correctness、freshness 與 source validity 可平行執行，quorum deterministic。
- [x] Mandatory criterion 不可被 majority 覆蓋，verifier cost 計入 Goal budget。

## Qualification

- `npm run smoke:fresh-semantic-verifier` — runtime request guard and unique fresh-context nonces; forbidden worker/provider context exclusion; required-mode Outbound Data Gate inspection and blocked-gate fail-closed; three overlapping correctness/freshness/source-validity checks; deterministic all/majority/mandatory policies; correctness mandatory veto; immutable verifier evidence digest; per-criterion and aggregate Goal token/cost budget enforcement; missing runtime blocks semantic acceptance.
- `npm run smoke:acceptance-gate`
- `npm run smoke:goal-contract` — immutable `semantic-rubric` criterion admission.
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts` — `fresh-semantic-verifier-v1` is advertised by the shipped Host handshake after `npm run build`.
- `npm run smoke:prod` (37 passed)
- `npm run build`
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- targeted `oxlint` on semantic verifier, Acceptance Gate/contracts, Goal Contract, protocol, and smoke modules
- `git diff --check`
