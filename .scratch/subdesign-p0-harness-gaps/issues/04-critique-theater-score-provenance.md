# 04 — Critique theater 顯示分數溯源

**What to build:** Critique theater 的每項分數旁顯示產生它的 gate 記錄：gate id、執行時間戳、量測值摘要，可展開檢視。使用者（reviewer）可以逐項查帳——「這個 92 分是誰量的、什麼時候量的」。本票只做只讀呈現；evidence 裡沒有 gate 條目時顯示「not verified」狀態而非隱藏。

**Blocked by:** 01 — Gate evidence contract + fail-closed verdict

**Status:** 可交給代理

- [ ] 每項分數旁呈現對應 gate 記錄（id、時間戳、量測值）
- [ ] 無 gate 條目的分數明確標示未驗證，不偽裝成已驗證
- [ ] 元件層 fixture 驗證有/無 gate 證據兩種呈現狀態
- [ ] 呈現遵循既有 critique UI 的視覺文法與 reduced-motion fallback
