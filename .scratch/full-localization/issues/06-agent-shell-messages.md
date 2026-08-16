# 06 — agent 殼層系統訊息在地化

**What to build:** agent 回饋給使用者的系統訊息（排隊位置、忙碌轉向、核准與安全攔截、執行失敗原因、自動化建立回饋）改走 `t(key)`。模型自己產生的回覆內容不在此列——只在地化「殼」。

**Blocked by:** 01

**Status:** 可交給代理

- [ ] coordinator／policy／queue／核准路徑的系統訊息改走 `t(key)`
- [ ] 模型輸出內容（agent 回覆、報告正文）維持不翻
- [ ] 帶執行資料的訊息（佇列位置、剩餘缺口數）以 `{param}` 內插
- [ ] 對帳 smoke 全綠；`npm run build`、smoke、元件測試全綠
