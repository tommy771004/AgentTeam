# 15 — Pi Host turn routing prefactor

**What to build:** 將 Pi Host Protocol 中高分支密度的 turn routing 收進既有 owning domains，同時保持 versioned protocol、approval、execution evidence 與 settlement 語意。

**Blocked by:** 09 — No-App-launch deterministic qualification；10 — Merge-base complexity qualification。

**Status:** 已完成

- [x] Public protocol dispatcher 只做 validation、version routing 與 domain delegation，不重建 owning domain branches。
- [x] Submit、steer、queue、cancel、interrupt、approval 與 terminal settlement 的 externally observable responses 不變。
- [x] Malformed、stale revision、unknown run/session 與 duplicate request 繼續 fail closed。
- [x] Deletion/ownership guard 指向新的實際 owner，不以複製 source text 讓 smoke 通過。
- [x] Complexity 實質下降，Host 仍是 tool loop、execution、approval 與 settlement 唯一 authority。

## Implementation evidence

- `piHostTurnDomain.ts` now owns versioned `turn/submit`, `turn/interrupt`, and `turn/cancel` method routing plus control-parameter validation; injected callbacks leave execution and settlement in the Pi Host.
- The public protocol no longer repeats method-name branches or inline interrupt/cancel control flow for turn routing. Submit admission, configuration, capability loading, Working State setup and settlement remain in explicit Host-owned helpers reached through the turn domain callback.
- Protocol, steer/queue, queue settlement, cancel, interrupt, Plan Gate, build, and complexity smokes pass. The complexity gate rejected the initial complexity-83 extraction; the owner was decomposed until every new helper met the new-function budget, without a baseline exemption.
