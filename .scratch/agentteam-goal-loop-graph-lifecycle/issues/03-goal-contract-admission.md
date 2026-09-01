# 03 — Goal Contract admission 與 fail-closed

**What to build:** 讓 Goal-based run 在第一個 provider call 前取得 immutable、可追溯且可驗證的 Goal Contract，無 executable criterion 時誠實結束為 unverifiable。

**Blocked by:** 02 — 擴充正交 Outcome vocabulary.

**Status:** resolved

- [x] Goal Contract 經 validate、freeze、digest 並寫入 canonical record 後才允許 provider call。
- [x] Goal mode 沒有 executable criterion 時 fail closed 為 unverifiable，不能以 answered 代替。
- [x] Existing typed working goals 可無損轉換，任意文字 DoD 不被當作 executable checker。
- [x] 新 guarantees 僅在 negotiated protocol capability 與預設關閉的 feature flag 下啟用。

## Qualification

- `npm run smoke:goal-contract` — asserts provider call count remains zero for unverifiable admission; verifies digest tamper detection, deep freeze, lossless file-content mapping, record ordering, IPC forwarding, default-off flag, and capability negotiation.
- `node --experimental-strip-types scripts/smoke-pi-host-protocol.mts`
- `node --experimental-strip-types scripts/smoke-pi-turn-record.mts`
- `node --experimental-strip-types scripts/smoke-pi-working-state-completion.mts`
- `node --experimental-strip-types scripts/smoke-run-lifecycle.mts`
- `node --experimental-strip-types scripts/smoke-prod-modules.mts` (37 passed)
- `npm run build`
- targeted `oxlint` on changed production and smoke modules
- `npm run check:pi-contract`
- `npm run check:complexity`
- `npm run smoke:complexity-merge-base`
- `git diff --check`
