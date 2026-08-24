# 09 — Workspace 非等價工具，掛上 file mutation queue

**What to build:** agent 能在專案裡搬檔案、刪檔案、建目錄、取 diff、下載產出物，而且同一個 turn 裡兩個工具動到同一個檔案時，改動不會互相覆蓋掉。

依 ADR-0027，與 Pi builtin 行為等價的工具要**移除**（那是 14 / 15 兩張票）；這張票處理**沒有**對應 builtin 的那五個，它們要以獨立命名的 extension tool 存在。

Pi 的 `withFileMutationQueue()` 是這裡的關鍵：`edit` 與 `write` 已經在同一個 per-file queue 上，新工具不參加就會發生「兩個工具讀到同一份舊內容、各自寫回、後寫的蓋掉先寫的」。

**Blocked by:** 01

**Status:** 可交給代理

- [x] `workspace_diff` / `workspace_move` / `workspace_delete` / `workspace_mkdir` / `workspace_download` 註冊為獨立命名的 extension tools
- [x] 所有會變更檔案的工具用 `withFileMutationQueue()`，且傳入解析後的絕對目標路徑（非原始參數）
- [x] 整段 read-modify-write 都在 queue 內，不只最後那次寫入
- [x] 專案範圍限制：逃出 root 的路徑被拒絕
- [x] 變更檔案的工具走 Approval Decision
- [x] 測試在單一接縫，含「同 turn 兩個工具動同一檔案不互相覆蓋」的斷言
