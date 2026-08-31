# 04 — Credential vault expand contract

**What to build:** 在不破壞既有 integration 的前提下，擴充 main-process vault 為 Telegram、Webhook 與 custom-tool 共用的 credential authority，提供 stable reference 與 renderer-safe metadata 契約。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Vault contract 支援 store、use、rotate、clear、metadata list 與 restart persistence。
- [ ] Preload／renderer 只能送 typed intent 並接收 configured state、token hint 與非敏感 metadata，沒有 raw-token getter。
- [ ] OS-backed encryption 不可用時預設拒絕持久化，錯誤原因可被 UI 誠實呈現。
- [ ] 新 vault form 可與 legacy settings 暫時並存，讓後續 migrate tickets 能逐批落地且每批保持綠燈。
- [ ] Contract smoke 證明 raw token 不進入 Pi Host resources、capability metadata 或 Turn Record。
