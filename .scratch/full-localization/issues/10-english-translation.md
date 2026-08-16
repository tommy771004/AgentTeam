# 10 — English 語言檔

**What to build:** 英文使用者把介面切成 English 之後，能不依賴中文操作全部功能。en 語言檔覆蓋已遷入的 key；尚未翻譯的 key 自動 fallback zh-TW 且在對帳報表列出，畫面不會炸也不會靜默。

**Blocked by:** 02, 03, 04, 05, 06, 07

**Status:** 可交給代理

- [ ] en 語言檔覆蓋所有已遷入的 key
- [ ] 缺翻 key fallback zh-TW，並在 smoke 輸出清單
- [ ] 英文文案在既有版面中不溢出、不截斷（長字串檢查）
- [ ] 切到 English 後主要流程可完整操作
