# 07 — Legacy raw-secret contract removal

**What to build:** 完成 credential expand–contract 的 contract 階段，刪除 flat settings 中所有 raw integration secret paths，使 main-process vault 成為唯一 production authority。

**Blocked by:** 05 — Telegram／Webhook vault migration；06 — Custom-tool vault migration。

**Status:** resolved

- [x] Flat settings schema、defaults、merge、local persistence、IPC projection 與 bundle import/export 不再接受或回傳 raw integration credentials。
- [x] Legacy data 只可進入 idempotent migration ingress，不能重新被 renderer hydration 復活。
- [x] Deletion/ownership guard 阻止新增 renderer raw-token field、getter 或 legacy disk fallback。
- [x] Full credential qualification 覆蓋 migration、restart、runtime use、rotate、clear、redaction 與 safe-storage fail-closed。
- [x] Security baseline 所宣告的 main-only boundary 與 shipped behavior 一致。

## Comments

2026-08-31 — Credential expand–contract 完成。`LlmSettings`、defaults、merge keys、renderer persistence/UI 與 bundle export 已刪除 Telegram、Webhook、custom-tool raw fields；migration-only keys 集中於 `integrationCredentials.ts`，deletion guard 鎖住 renderer raw fields/getters、main disk decrypt fallback 與 runtime settings fallback。`docs/SECURITY_BASELINE.md` 已對齊 shipped main-only execution behavior。證據同 #06：`smoke:credential-vault`、security/caps、Marketplace placeholder contract、build、完整 smoke 與 Browser UI 複查全綠；Paid Beta 仍維持 NO-GO，不由本票推導 release readiness。
