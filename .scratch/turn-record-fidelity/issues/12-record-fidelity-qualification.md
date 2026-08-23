# 12 — Record fidelity qualification

**What to build:** 一條把整件事釘死的驗收鏈：五種結算彼此可區分、歷史跨 Host 重啟連續、renderer reload 後由 Host 重建、外部 CLI 與內建同形、長跑的完整執行過程可分頁讀回。這一票不加新功能，它證明前十一票合起來真的成立 —— 並且讓「先前那個把開場白當結論發布的缺陷類別」在 CI 層級無法復發。

**Blocked by:** 10, 11

**Status:** 可交給代理

- [ ] 一條 qualification smoke 鏈涵蓋：`answered` / `empty` / `interrupted(user)` / `interrupted(timeout)` / `failed` / `cancelled` 各自可區分
- [ ] 涵蓋 Host 重啟後歷史連續、renderer reload 後由 Host 重建
- [ ] 涵蓋外部 CLI 與內建 run 的帳本同形，且能力宣告差異仍在
- [ ] 涵蓋超過舊記憶體上限的長跑，完成後執行過程可分頁完整讀回
- [ ] 涵蓋多段 assistant 的回合結算在最後一段（原始缺陷的 regression）
- [ ] 所有新 smoke 匯入實際出貨模組，不得就地重寫被檢查的邏輯，也不得為了讓 import 成功而加 loader 相依
- [ ] 掛進 smoke chain；`npm run build`、`npm run smoke`、`npm run smoke:pi-host` 全綠
