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

2026-08-31 — Custom-tool vault migration 已完成。

- [Custom-tool migration authority](../../../app/electron/customToolCredentialMigration.ts) 讀取既有 raw／`encryptedCustomToolSecrets`，以 stable `credential:custom-tool:<ownerId>` 寫入共用 Vault；既有 Vault record 優先，逐筆 main-only readback 後才 temporary-file + rename scrub。安全儲存、解密、寫入或 readback 失敗均保留原檔。
- Settings disk／renderer projection 不再解密或保存 custom-tool raw map；舊 localStorage 與 bundle import 只可經 `credentials:migrateLegacy` ingress。Settings UI 改用 metadata-only typed intents，支援 store／rotate／clear、hint 與 secure-storage unavailable 狀態。
- [Custom Tools Pi Extension Pack](../../../app/electron/piExtensionPacks/customToolsPack.ts) 是正式執行 owner；它以 reference-only tool name／input 呼叫 Host service。Electron main 從已遷移設定選取已註冊 template，並由 [customToolExecution](../../../app/electron/customToolExecution.ts) 在 bash／HTTP 最後一刻解析 Vault placeholder。一般 `shell:bash` 未取得讀取 Vault 的權限。
- MCP stdio 僅保存 placeholder args/env，spawn 時才解析；status 仍投影 reference。Bash、HTTP、MCP success／failure 的 reflected credential 會在回 renderer／Pi 前遞迴遮罩。
- [Owning smoke](../../../app/scripts/smoke-custom-tool-credential-migration.mts) 已掛 `smoke` → `smoke:release` → `smoke:credential-vault`，覆蓋 raw/encrypted migration、冪等與 Vault-wins、safe-storage fail-closed、restart、store/rotate/clear、真 bash、真本機 HTTP、MCP reflected-error、Pi Host service pack 與 export redaction。
- Focused credential smoke、Pi Host tool contract／catalog／pack smoke、scoped oxlint 與 `git diff --check` 通過。雙軸 review 初次發現的 MCP status/error、execution output 反射與 renderer second-owner 均已修復；最終 Spec review 無剩餘 finding。
- 本輪完整 `npm run smoke` 已啟動並跑至後段 Pi Host suites，但 RTK/npm parent 在沒有 child process 時持續不結束，10 分鐘後終止，故不宣稱 full smoke 綠。最終 build 重跑被同時進入工作樹、非本票的 `pi-package` toolSource 型別變更阻擋；本票新增模組已由 shipped Vite smoke bundle 編譯執行。Ticket 12 最終 qualification 仍須在整合工作樹取得完整 build/full-smoke 證據。
- #07 將刪除 flat settings schema/default 中仍為 migration compatibility 保留的 raw 欄位；本票已阻止其進入 production persistence/runtime。Paid Beta 維持 NO-GO。
