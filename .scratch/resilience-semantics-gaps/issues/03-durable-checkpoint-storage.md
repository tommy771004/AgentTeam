# 03 — Checkpoint/journal 搬主進程權威儲存

**What to build:** compaction checkpoint 與 run 相關的持久化狀態搬到主進程的權威儲存層(與 durable journal 同一去處),不再受 localStorage 的 LRU 數量與容量限制——quota 滿了降級只留摘要的行為消失。renderer 重整、app 重啟後,checkpoint 仍在。不做相容層:localStorage 版本直接刪除。

**Blocked by:** None — can start immediately(04 與 05 的地基/prefactor)

**Status:** resolved

- [x] checkpoint 寫讀走主進程儲存層,重啟後可取回
- [x] 無 LRU 上限與容量降級路徑
- [x] localStorage 版本的寫入/讀取程式碼移除,不留 fallback
- [x] kill-and-restart 測試:checkpoint 後殺掉 Host,重啟後 checkpoint 完整可讀
- [x] 既有 smoke(drift guards)改指新 owner 後全綠
