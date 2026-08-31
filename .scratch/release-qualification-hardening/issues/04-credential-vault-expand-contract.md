# 04 — Credential vault expand contract

**What to build:** 在不破壞既有 integration 的前提下，擴充 main-process vault 為 Telegram、Webhook 與 custom-tool 共用的 credential authority，提供 stable reference 與 renderer-safe metadata 契約。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Vault contract 支援 store、use、rotate、clear、metadata list 與 restart persistence。
- [x] Preload／renderer 只能送 typed intent 並接收 configured state、token hint 與非敏感 metadata，沒有 raw-token getter。
- [x] OS-backed encryption 不可用時預設拒絕持久化，錯誤原因可被 UI 誠實呈現。
- [x] 新 vault form 可與 legacy settings 暫時並存，讓後續 migrate tickets 能逐批落地且每批保持綠燈。
- [x] Contract smoke 證明 raw token 不進入 Pi Host resources、capability metadata 或 Turn Record。

## Comments

2026-08-31 — 完成 expand contract，未開始 #05–#07 legacy migration。

- [Credential authority](../../../app/electron/credentialVaultAuthority.ts) 定義 stable `credential:<kind>:<ownerId>` reference、store/rotate/clear/list intent、renderer-safe availability 與 metadata。Raw use 僅由 [main adapter](../../../app/electron/integrationCredentialVault.ts) callback 提供；preload 不提供 getter。
- [Shared vault](../../../app/electron/secretsVault.ts) 寫入失敗不再回報成功或發布新 cache；鎖定／解密失敗不再偽裝為空 vault。Clear 不得把剩餘密文降級成明文，legacy plaintext consent 也不能降級新 credential namespace。`basic_text` 不算 OS-backed encryption；metadata 記錄實際儲存 revision 的加密狀態。該檔原有混合換行統一為 LF。
- Gate evidence：[smoke-credential-vault-contract.mts](../../../app/scripts/smoke-credential-vault-contract.mts) 5/5，接在 `npm run smoke` → `smoke:release` → `smoke:credential-vault`。涵蓋操作、metadata canary、非法 intent、錯誤不回傳 raw secret、Pi/Turn Record owner 隔離，以及 shipped adapter 的磁碟 round-trip／fresh module restart／keychain unavailable／write refusal。僅替換 Electron OS 邊界，不模擬產品 Vault 實作；此 fixture 不宣稱真機 keychain qualification。
- 本輪完整 `npm run smoke` exit 0（含 Electron reattach E2E）；其後補強的 disk/keychain case 已重跑 focused credential/release/security smoke、Pi contract guard、build/typecheck 與 scoped oxlint。Standards 與 Spec 雙軸複查均無剩餘 actionable finding。
- 僅此新契約不向 Pi resources、capability catalog 或 Turn Record 傳 raw token；既有 flat settings 仍保留到 #05–#07 分批遷移，不能解讀為所有 credential migration 已完成。Paid Beta 維持 NO-GO。
