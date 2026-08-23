# 01 — Abortable turn 協定

**What to build:** 使用者能主動中止一個執行中的任務:送出任務後取得 abort 句柄,按下中止後 Pi Host 在下一個 tool boundary 安全停車,settlement 回傳 `interrupted(by user)`;已投影到 feed 的部分輸出保留並以中斷標記封口,journal 記錄 terminal 事件。中止按鈕立即有視覺回饋(spinner 停止、狀態列更新)。畫面上「已中止」與「失敗」是不同的說法。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] submit 後觸發 abort,settlement 成因為 `interrupted(by user)`,不是 failed
- [ ] Host 在 tool boundary 停車,不在 tool 執行中途硬切(以假工具驗證停車點)
- [ ] feed 中未完成的 text delta 以中斷標記封口,已完成的部分輸出保留
- [ ] journal 有 terminal 記錄,lifecycle 投影顯示「已中止」語彙(tone 與 failed 不同)
- [ ] UI 中止操作有立即回饋,不等待 settlement 才反應
- [ ] 測試從 taskRunCoordinator.runTask 與 Pi Host 協定邊界驅動,不測內部私有函式
