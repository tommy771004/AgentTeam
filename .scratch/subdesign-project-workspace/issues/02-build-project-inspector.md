# 02 — Build 執行中的專案 Inspector

**What to build:** 當 SubDesign brief 正在執行 task run 時，使用者能在同一個 Studio 看見與目前 Build 階段相關的 live activity、預期輸出、執行時間與完整逐字稿入口；執行結束後，畫面能回到正確的 artifact / gate 狀態。

**Blocked by:** 01 — SubDesign 階段與下一關卡

**Status:** ready-for-agent

- [x] live activity 只顯示目前 brief linked task run 的 run-scoped 狀態，不會混入其他 thread 或 concurrent run。
- [x] 執行中狀態明確說明 agent 正在產生什麼，以及完成後會開放哪個 gate。
- [x] 使用者可主動開啟完整逐字稿，但不會被強制導離 SubDesign Studio。
- [x] task run 完成、失敗、取消與外部 CLI 結束都能正確回到對應的階段與 gate。
- [x] 既有 canonical coordinator ingress、busy policy、取消與 approval 行為不變。
