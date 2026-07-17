# 01 — 建立 coordinator-owned Task run contract

**What to build:** 讓使用者提交一個 built-in Task run 時，`taskRunCoordinator.runTask` 真正負責 admission、固定 run identity、建立 dispatch snapshot、執行 runner 並完成成功路徑；現有呼叫端仍得到相同的 terminal result 與 thread presentation。

**Blocked by:** None — can start immediately

**Status:** 已實作並驗證；待使用者審閱

- [ ] `runTask` 是 built-in Task run 的唯一 lifecycle owner；不再只是轉交給 legacy orchestration。
- [ ] accepted run 只 reserve 一次 capacity、bind 一次 thread、prepare 一次 dispatch snapshot。
- [ ] built-in 成功結果經 coordinator finalization 後，thread summary、assistant completion、Archive、`onSettled`、capacity release 與 queue drain 均可觀察且各執行一次。
- [ ] default single-run 與 opt-in concurrent run 的既有行為保持不變。
- [ ] scenario smoke 透過 `runTask` 驗證上述外部行為，沒有測試 private implementation detail。
