# 14 — Parity 證明與移除：唯讀等價工具

**What to build:** 讀一個檔案這件事，整個 codebase 只有一份實作。`workspace_read` / `workspace_list` / `workspace_grep` / `workspace_glob` 與 Pi builtin 的 `read` / `ls` / `grep` / `find` 行為等價，依 ADR-0027 應**移除**而非別名保留。

這張票的產出是一份**刪除授權**：parity 測試通過才刪，證據不足就不該合併。

**Blocked by:** 03

**Status:** 可交給代理

- [x] 每一對逐項證明 parity：parameter schema、成功結果形狀、錯誤結果形狀、streaming updates、取消、專案範圍、session recording
- [x] 逃出 root 的路徑在新舊兩邊都同樣被拒絕（比照 `scripts/smoke-pi-equivalent-tools.mts`）
- [x] parity 通過後刪除四個 renderer 工具與其註冊
- [x] 目錄投影反映刪除結果，舊名稱不再出現
- [x] 測試在單一接縫；parity 斷言與刪除在同一張票內完成
