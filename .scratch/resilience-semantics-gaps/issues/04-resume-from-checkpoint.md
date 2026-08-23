# 04 — Interrupted run 從 checkpoint 續跑

**What to build:** 被中止或逾時的任務可以從最後的 checkpoint 繼續,而不是從頭再來:使用者對 interrupted run 選擇「續跑」,入口走唯一的 run coordinator ingress,replay-safe checkpoint 保證已發生的 side effects(發信、寫檔)不重放。若無法證明某個 side effect 未發生,fail-closed 拒絕續跑並如實告知使用者原因。同一份 checkpoint 不會被觸發兩次續跑。

**Blocked by:** 01 — Abortable turn 協定;03 — Durable checkpoint storage

**Status:** resolved

- [x] interrupted(by user/timeout)的 run 在 UI 上有「續跑」入口
- [x] 續跑後從最後 checkpoint 的 step 接續,已完成步驟不重跑
- [x] kill-and-restart 情境:checkpoint 後殺掉 Host、重啟、續跑成功
- [x] side-effect 工具以 execution evidence 計數驗證不被重放
- [x] 無法證明 side effect 未發生的情境 fail-closed 拒絕續跑,並向使用者說明原因
- [x] 同一 checkpoint 重複觸發只生效一次(idempotent resume)
