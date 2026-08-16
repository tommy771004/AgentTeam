# 09 — 原生選單與系統通知跟隨語言

**What to build:** 切換介面語言後，Electron 的原生選單、右鍵選單與 OS 通知也跟著變——整機體驗一致，不會出現英文介面配中文選單。選單字串由 main process 擁有，renderer 不持有選單文案。

**Blocked by:** 01

**Status:** 可交給代理

- [ ] 語言變更事件跨 process 傳播，選單依語言重建
- [ ] OS 通知文字跟隨語言
- [ ] renderer 不擁有選單字串
- [ ] 瀏覽器環境（無 Electron）不受影響
