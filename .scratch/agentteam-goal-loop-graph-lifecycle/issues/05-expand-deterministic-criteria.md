# 05 — 擴充 deterministic criteria

**What to build:** 讓 build、test、artifact schema 與 historical review requirements 能由 Host 以固定 registry 與 revision-bound evidence 驗證。

**Blocked by:** 04 — Acceptance Gate 首條完整路徑.

**Status:** resolved

- [x] Registered command 與 test suite 只能引用 Host registry，不能注入自由 shell。
- [x] JSON schema／artifact criterion 驗證 machine-consumed output contract。
- [x] Review verification 綁定 immutable snapshot revision，不以 live working tree 補位。
- [x] Failed criterion 具 reason、evidence refs 與 retryability facts。

## Qualification

- `npm run smoke:deterministic-criteria` — fixed Host command/test registry, injection rejection, artifact existence/digest and registered JSON Schema checks, immutable review snapshot revision binding, reason/evidence/retryability facts.
- `npm run smoke:acceptance-gate`
- `npm run smoke:goal-contract`
- `node --experimental-strip-types scripts/smoke-pi-turn-record.mts`
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts`
- `node --experimental-strip-types scripts/smoke-pi-working-state-completion.mts`
- `node --experimental-strip-types scripts/smoke-prod-modules.mts` (37 passed)
- `npm run build`
- targeted `oxlint` on changed production and smoke modules
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- `git diff --check`
