# 06 — Custom-tool vault migration

**What to build:** 讓 custom-tool secret placeholders 在 main side 最後一刻解析，設定與工具 metadata 只保留 reference；safeStorage 不可用時不再經 legacy bridge 明文落地。

**Blocked by:** 04 — Credential vault expand contract。

**Status:** resolved

- [x] Custom-tool secret store/rotate/clear 使用 stable credential IDs 與 main vault。
- [x] Tool invocation 只在 main-owned execution seam 解析 placeholder，renderer 與 Pi catalog 看不到 raw value。
- [x] OS-backed encryption unavailable fixture 證明 persistence fail closed 且不建立 plaintext settings copy。
- [x] Existing encrypted legacy custom-tool values 可一次性、可重跑地遷移至共用 vault。
- [x] Tool success/failure、restart 與 redacted export 均有 shipped behavior smoke。

## Comments

2026-08-31 — Custom-tool credential migration 收口。`credential:custom-tool:<ownerId>` stable refs 經 typed intent store／rotate／clear；HTTP、bash 與 MCP 只在 main execution seam 解析 placeholder，回應、錯誤、session metadata 與截斷輸出均不反射 token。舊 `encryptedCustomToolSecrets`／flat map 採 vault-first、驗證後 scrub 的冪等 migration；OS secure storage 不可用時保留唯一舊 copy 並 fail closed。Owning evidence 為主鏈 `npm run smoke:credential-vault`（含真 process MCP/bash、restart、import-immediate-use 與 output-cap canary）；完整 `npm run smoke`、`npm run build`、scoped oxlint 與 Browser degraded UI 複查全綠。
