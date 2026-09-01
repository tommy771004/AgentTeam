# 17 — Startup recovery phase prefactor

**What to build:** 將 startup recovery 拆成可測且有固定順序的 phases，使 Host snapshot、cursor replay、run reattachment 與 queue recovery 能在 reload/restart 後誠實收斂。

**Blocked by:** 09 — No-App-launch deterministic qualification；10 — Merge-base complexity qualification。

**Status:** 已完成

- [x] Recovery phases 明確區分 durable read、Host reconciliation、cursor replay、active reattachment、terminal finalization 與 queue drain。
- [x] UI Projection 不會以 renderer cache 覆蓋較新的 Host state，也不會復活 archived tombstone。
- [x] Active、terminal、missing、stale cursor、Host unavailable 與 corrupted local projection 都有 deterministic outcomes。
- [x] Reload 與 Electron restart behavior smokes 證明 timeline ordering、stop controls、settlement 與 startup non-blocking 語意。
- [x] Complexity 實質下降，沒有建立第二 timeline 或 recovery authority。

## Implementation evidence

- `startupRecoveryPhases.ts` enforces the canonical durable-read → Host reconciliation → cursor replay → active reattachment → terminal finalization → queue drain order and reports the phase that was entered and actually failed, including the final queue-drain phase.
- Active external-session classification moved out of `RecoveryBootstrap`; corrupt or non-array projections deterministically classify as no live sessions, while terminal/tombstoned sessions are never revived.
- Reattach-by-sequence, journal durability, unique finalization, real Electron restart reachability, build, and complexity smokes pass. `completeStartupRecovery()` remains in `finally`, so a failed recovery cannot permanently block startup.
