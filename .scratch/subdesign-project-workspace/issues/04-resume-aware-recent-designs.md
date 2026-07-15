# 04 — 可恢復的最近設計清單

**What to build:** 使用者從「繼續最近設計」選擇 brief 前，就能看到最近階段、最新 artifact、task run 狀態與下一個 gate；進入後仍回到同一個 deep-linked brief context，適合從中斷處繼續工作。

**Blocked by:** 01 — SubDesign 階段與下一關卡

**Category:** enhancement

**Status:** 可交給代理

- [x] recent brief card 顯示 last stage、latest artifact（若存在）、active/terminal run state 與 next gate。
- [x] 無 artifact、失敗、取消、critique pending 與已交付 brief 都有清楚且不誤導的摘要。
- [x] 點擊 card 仍使用既有 brief deep link，不依賴模糊的全域 selected brief 狀態。
- [x] recent list 不會因其他 brief 的 run activity 或 artifact 選取而顯示錯誤摘要。
- [x] 測試覆蓋多 brief、並行 run 與重新整理後的 resume presentation。
