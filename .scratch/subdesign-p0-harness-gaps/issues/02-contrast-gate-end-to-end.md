# 02 — 第一個 gate：state-aware contrast，端到端

**What to build:** 對比度檢查實作為註冊式 Pi Core tool（gate），經既有 tool registry 與 capability admission 進入 critique stage：runner 呼叫 gate、gate 對 artifact 執行量測（含 hover/focus/active 互動狀態的真實 computed style）、輸出寫入 `'gate'` evidence。使用者得到的改變：critique 的對比度分數第一次有可重現的量測依據。這張票驗證「gate 跑了 → 分數有據」整條路徑，後續 gates 照此模式複製。

**Blocked by:** 01 — Gate evidence contract + fail-closed verdict

**Status:** 可交給代理

- [ ] Contrast gate 註冊於 tool registry，僅在 critique stage 允許執行
- [ ] Gate 輸出為結構化量測（元素/狀態/ratio/pass-fail）並寫入 `'gate'` evidence
- [ ] Runner 能在 critique 迭代中呼叫 gate；gate 失敗不會偽造 pass verdict
- [ ] Tool registry drift guard 斷言 gate 已註冊且 stage 限制正確
- [ ] End-to-end smoke：帶 gate 證據的 critique 可 pass；無 gate 的 pass 被 fail-closed 拒絕
