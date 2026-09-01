# 03 — Goal Contract admission 與 fail-closed

**What to build:** 讓 Goal-based run 在第一個 provider call 前取得 immutable、可追溯且可驗證的 Goal Contract，無 executable criterion 時誠實結束為 unverifiable。

**Blocked by:** 02 — 擴充正交 Outcome vocabulary.

**Status:** ready-for-agent

- [ ] Goal Contract 經 validate、freeze、digest 並寫入 canonical record 後才允許 provider call。
- [ ] Goal mode 沒有 executable criterion 時 fail closed 為 unverifiable，不能以 answered 代替。
- [ ] Existing typed working goals 可無損轉換，任意文字 DoD 不被當作 executable checker。
- [ ] 新 guarantees 僅在 negotiated protocol capability 與預設關閉的 feature flag 下啟用。

