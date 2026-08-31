# 08 — Atomic settings persistence

**What to build:** 讓一般 settings 在 crash、磁碟錯誤或寫入中斷後，永遠恢復為舊的完整值或新的完整值，不留下截斷 JSON，也不靜默假裝設定不存在。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Settings 使用 temporary write、必要 flush、atomic rename 與明確權限完成 persistence。
- [ ] Last-good recovery 能區分 no-settings、corrupt-primary 與 recovered states。
- [ ] Failure injection 覆蓋 temp write 前／中、rename 前與 rename 後，restart 結果永不為 truncated JSON。
- [ ] Recovery 或 write failure 可被診斷但不暴露 credential material。
- [ ] Existing settings merge、migration 與 renderer projection 行為保持相容。
