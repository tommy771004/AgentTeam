# 04 — 「排程」tile 改為預填建立排程任務

**What to build:** 使用者在 composer 輸入「每天早上整理 inbox」後點「排程」，不再只是替這個對話標記語意（過去點了什麼也不會發生），而是就地開啟一張建立排程任務的表單：目標欄已用輸入的文字預填，並提供名稱、頻率（每日／間隔／單次）等欄位。建立成功後表單關閉、對話內留下一則系統訊息說明已建立哪個排程，且該排程立即出現在自動化頁的清單中（兩處狀態一致）。取消則什麼都不建立，輸入內容保留。composer 本身不會送出帶 Time 語意的 run——真正的觸發仍只能由排程觸發證據進入。

**Blocked by:** 03

**Status:** resolved

- [x] 點「排程」開啟建立表單，目標欄以 composer 現有文字預填；輸入為空時給合理提示而非建立空任務
- [x] 建立成功後對話內出現系統訊息，且自動化頁清單同步可見同一筆
- [x] 取消不建立任何東西，composer 輸入內容保留
- [x] composer 不再產生 Time-based 語意的 run 請求（既有觸發證據模型不被繞過）
- [x] smoke（純邏輯）：tile 點擊組出的建立 payload（含空輸入回退）
- [x] 元件測試：預填、建立、取消三條路徑

## Answer

「定時」格改為建立動作：`AutomationCreateSheet` 以 composer 文字預填目標，`buildScheduleDraft` 從文字讀出每日/間隔（沿用並匯出 `parseScheduleHintFromText`，與建議卡同一份判讀），建立走既有 `scheduleStore.addJob`，自動化頁清單同步。建立後於對話留系統訊息（含觸發時機）。目標為空時「建立」停用並提示，不建立空任務。`jobRunnerFor` 收斂 ScheduledJob 較窄的 runner union（gemini → builtin）並把降級講給使用者聽，而不是默默換掉。
