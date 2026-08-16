# 03 — 系列驗收

**What to build:** `automation-one-click` 全系列整合驗收：三種自動檢查（`npm run build`、`npm run smoke`、元件測試）全綠；手動走一次「對話說出意圖 → 卡片出現 → 改時間 → 建立 → 自動化頁看到 → 實際觸發一次」的端到端；確認安全模型未被放寬。最後同步 `.scratch/INDEX.md` 與 spec 狀態。

**Blocked by:** 01, 02

**Status:** 可交給代理

- [ ] `npm run build`、`npm run smoke`、元件測試全綠，輸出摘錄記於 Comments
- [ ] 端到端手動驗證：意圖 → 卡片 → 改時間 → 建立 → 自動化頁同步 → 實際觸發
- [ ] 安全模型確認未放寬：無同意不建立、對話文字不直接啟動 Time/Proactive
- [ ] `.scratch/INDEX.md` 與 spec 狀態同步更新
