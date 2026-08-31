# 08 — Atomic settings persistence

**What to build:** 讓一般 settings 在 crash、磁碟錯誤或寫入中斷後，永遠恢復為舊的完整值或新的完整值，不留下截斷 JSON，也不靜默假裝設定不存在。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Settings 使用 temporary write、必要 flush、atomic rename 與明確權限完成 persistence。
- [x] Last-good recovery 能區分 no-settings、corrupt-primary 與 recovered states。
- [x] Failure injection 覆蓋 temp write 前／中、rename 前與 rename 後，restart 結果永不為 truncated JSON。
- [x] Recovery 或 write failure 可被診斷但不暴露 credential material。
- [x] Existing settings merge、migration 與 renderer projection 行為保持相容。

## Comments

2026-08-31 — `SettingsPersistence` 成為一般 settings 與 credential migration 的單一磁碟 owner：同目錄 0600 temp、file fsync、atomic rename、directory fsync（Windows 保留 atomic rename）與 0600 last-good。`settings:get` 維持原 settings／null projection，另提供 metadata-only diagnostics；startup integration auto-start 也走相同 recovery lifecycle。真實檔案 failure matrix 覆蓋 temp write 前／中、rename 前／後與 fresh-reader restart，並驗證 no-settings、primary、recovered-last-good、corrupt-primary、權限及 migration scrub 後 last-good 不含 raw credentials。`smoke:settings-persistence` 已納入 `smoke:release`；credential migration、build、scoped oxlint（僅四個既有 main warning）與完整 `npm run smoke` 全綠。Paid Beta 仍為 NO-GO（0/43）。
