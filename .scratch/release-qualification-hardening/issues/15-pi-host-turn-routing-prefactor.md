# 15 — Pi Host turn routing prefactor

**What to build:** 將 Pi Host Protocol 中高分支密度的 turn routing 收進既有 owning domains，同時保持 versioned protocol、approval、execution evidence 與 settlement 語意。

**Blocked by:** 09 — No-App-launch deterministic qualification；10 — Merge-base complexity qualification。

**Status:** 可交給代理

- [ ] Public protocol dispatcher 只做 validation、version routing 與 domain delegation，不重建 owning domain branches。
- [ ] Submit、steer、queue、cancel、interrupt、approval 與 terminal settlement 的 externally observable responses 不變。
- [ ] Malformed、stale revision、unknown run/session 與 duplicate request 繼續 fail closed。
- [ ] Deletion/ownership guard 指向新的實際 owner，不以複製 source text 讓 smoke 通過。
- [ ] Complexity 實質下降，Host 仍是 tool loop、execution、approval 與 settlement 唯一 authority。
