# 03 — Journal list 查詢 API

**What to build:** run journal 除了單筆查詢外提供列表讀取：依 kind（run/queue/schedule/background）與時間排序列出條目，供報告的 join 與未來生命週期視圖消費。純讀取，不改寫入語義與容量上限。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `listJournal(kind?)` 匯出（含時間排序、上限內行為）
- [x] smoke：寫入 fixture 條目後列表正確、kind 過濾正確、不影響既有 get/recovery

## Answer

`listJournal(kind?)`（updatedAt 新→舊；MemoryStorage stub 下 smoke 驗證 kind 過濾、全量、單調排序）＋`findJournalEntryByRunId`（run kind 優先、附屬 queue/schedule 條目可經 runId 找到）。純讀取，寫入語義與容量上限不變。smoke-run-reports 第 3 組；既有 smoke-run-journal 回歸不受影響。
