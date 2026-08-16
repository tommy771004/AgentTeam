# 13 — 系列驗收

**What to build:** `full-localization` 全系列整合驗收：三種自動檢查全綠；zh-TW 與 English 各走一次主要流程；Electron 選單與通知實機切換；兩主題視覺比對。最後同步 `.scratch/INDEX.md` 與 spec 狀態。

**Blocked by:** 08, 09, 10, 11, 12

**Status:** 可交給代理

- [ ] `npm run build`、`npm run smoke`、元件測試全綠，輸出摘錄記於 Comments
- [ ] zh-TW 體驗與升級前逐字相同（視覺零 diff 抽樣確認）
- [ ] English 介面走完主要流程無中文殘留
- [ ] Electron 選單／通知實機切換、兩主題視覺比對
- [ ] `.scratch/INDEX.md` 與 spec 狀態同步更新
