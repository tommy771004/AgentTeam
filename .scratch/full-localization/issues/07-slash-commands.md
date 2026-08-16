# 07 — slash 指令與 Command Palette 在地化

**What to build:** slash 指令的標題與描述、Command Palette 的分類標籤與空狀態文字改走 `t(key)`，讓英文介面下的指令面板可讀。指令名稱本身（`/clear` 等）維持不變——那是使用者輸入的識別字，不是文案。

**Blocked by:** 01

**Status:** 可交給代理

- [ ] 指令描述與分類標籤改走 `t(key)`
- [ ] 指令名稱與別名維持原樣（可輸入的識別字不翻譯）
- [ ] palette 過濾在兩種語言下都能命中對應指令
- [ ] 對帳 smoke 全綠；`npm run build`、smoke、元件測試全綠
