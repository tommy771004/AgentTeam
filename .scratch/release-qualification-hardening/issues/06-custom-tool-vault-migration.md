# 06 — Custom-tool vault migration

**What to build:** 讓 custom-tool secret placeholders 在 main side 最後一刻解析，設定與工具 metadata 只保留 reference；safeStorage 不可用時不再經 legacy bridge 明文落地。

**Blocked by:** 04 — Credential vault expand contract。

**Status:** 可交給代理

- [ ] Custom-tool secret store/rotate/clear 使用 stable credential IDs 與 main vault。
- [ ] Tool invocation 只在 main-owned execution seam 解析 placeholder，renderer 與 Pi catalog 看不到 raw value。
- [ ] OS-backed encryption unavailable fixture 證明 persistence fail closed 且不建立 plaintext settings copy。
- [ ] Existing encrypted legacy custom-tool values 可一次性、可重跑地遷移至共用 vault。
- [ ] Tool success/failure、restart 與 redacted export 均有 shipped behavior smoke。
