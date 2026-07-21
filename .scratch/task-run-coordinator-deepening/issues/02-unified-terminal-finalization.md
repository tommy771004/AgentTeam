# 02 — 統一 denial、exception、cancel 的唯一 finalization

**What to build:** 當 Task run 被 beforeRun policy 拒絕、runner 例外或使用者以 run identity 停止時，使用者能看到一個明確 terminal outcome，且 lifecycle 收尾不遺漏、不重複、不影響其他 run。

**Blocked by:** 01 — 建立 coordinator-owned Task run contract

**Status:** resolved

- [x] hook denial 在已 admission 的 run 上只產生一次 failed terminal result、afterRun audit、Archive、`onSettled`、release 與 drain。
- [x] dispatch exception 與 adapter rejected promise 走同一 finalization contract，不留下 running thread 或 reserved capacity。
- [x] cancel 只影響指定 `runId`，並在 terminal cleanup 後才允許 queue 補跑。
- [x] concurrent run 中一個 run 的 denial/exception/cancel 不會改變另一個 run 的 activity、thread status 或 HITL。
- [x] smoke contract 能驗證 terminal ordering 與 exactly-once observable counts。
