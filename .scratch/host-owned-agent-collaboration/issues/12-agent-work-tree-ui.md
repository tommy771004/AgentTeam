# 12 — 對話中的 Agent Work Tree UI

**What to build:** 使用者在對話中看到屬於每個 Chat turn 的可折疊 Agent Work Tree：角色、task、lifecycle、message、conflict、result 與 adoption 都從同一 Turn Record 投影；完成後留在歷史，下一輪 active surface 不重播上一輪進度。

**Blocked by:** 01 — Agent tree 與 lifecycle read model; 06 — One-hop child completion delivery; 07 — Safe interrupt 與 descendant cancellation; 09 — Host-owned write scope 與 conflict notification; 11 — Sibling-settled Checker adoption.

**Status:** resolved（2026-08-30；見 `../qualification.md`）

- [x] Compact row 顯示 task name、role、status 與必要 attention，不顯示整段 raw prompt/log
- [x] 展開後依 Turn Record seq 顯示 message、tool/activity summary、conflict、terminal result 與 adoption
- [x] Late completion 回填 originating turn；下一輪 active panel 只顯示當輪 work
- [x] Live、reload、archive 與 replay 對相同 record 逐列一致
- [x] User 可從 authorized row 執行 follow-up、interrupt、ack/close 或前往 isolated review
- [x] Keyboard expansion、focus、screen-reader label、非顏色狀態與 hit target 符合 accessibility
- [x] Narrow layout 無橫向溢出，必要內容不依賴 animation 才可見
- [x] Rendered desktop/narrow evidence 與 interaction smoke 掛入主鏈
