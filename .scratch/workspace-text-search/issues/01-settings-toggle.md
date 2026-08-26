# 01 — 「工作區文字檢索」設定開關（治理根）

**What to build:** 使用者在 設定→一般 看到「工作區文字檢索」開關（預設**關閉**），切換會持久化、重啟後保留、隨既有 settings 快照語意走。這是本 effort 所有改動的治理根——後續票讓工具進生產路徑時，第一天就受這個開關管轄。

**Blocked by:** None — can start immediately

**Status:** 可交給代理

- [ ] `LlmSettings` 新增 boolean 欄位，預設 `false`，遵循三點編輯契約（型別/預設/UI）
- [ ] 設定合併對 boolean 欄位行為正確（匯出匯入 bundle 帶得上）
- [ ] UI 文案說明「開啟後模型才會取得搜尋工具」，繁中混英
- [ ] source-text drift guard 斷言預設值為 false 且 UI 掛在一般分頁
