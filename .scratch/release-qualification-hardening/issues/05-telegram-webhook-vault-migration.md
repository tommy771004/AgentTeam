# 05 — Telegram／Webhook vault migration

**What to build:** 讓使用者可照常設定、啟動、旋轉與清除 Telegram／Webhook credentials，但 runtime 只從 main-process vault 取得 raw values，renderer 只投影設定狀態。

**Blocked by:** 04 — Credential vault expand contract。

**Status:** 可交給代理

- [ ] Telegram 與 Webhook 的新 save/rotate/clear flow 全部經 vault typed intents。
- [ ] App restart 與 integration auto-start 從 vault reference 取得 credential，不再讀 legacy raw fields。
- [ ] Settings UI 顯示 configured/token hint 與 safe-storage failure，不回傳或重填 raw token。
- [ ] Migration smoke 覆蓋既有 raw settings、重跑冪等、vault write failure 與成功後移除 legacy raw fields。
- [ ] Renderer payload、localStorage、settings export 與 Turn Record 的 negative assertions 均找不到測試 token。
