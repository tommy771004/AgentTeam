# 04 — 收斂 queue、attachments 與 background delegate

**What to build:** 當 capacity 滿載、任務含附件或由 background delegate 觸發時，Task run 仍會保留原始 request、正確恢復執行，並只留下單一 execution Archive 與正確的 parent completion。

**Blocked by:** 01 — 建立 coordinator-owned Task run contract；02 — 統一 denial、exception、cancel 的唯一 finalization；03 — 讓 external CLI 共用 coordinator lifecycle

**Status:** 已實作並驗證；待使用者審閱

- [ ] queue drain 只重新進入 `taskRunCoordinator.runTask`，不直接呼叫 legacy lifecycle implementation。
- [ ] queued request 的 run identity、source kind、trigger evidence、project context 與 attachment file path 能安全保留至 drain。
- [ ] attachment normalize/materialize/hydrate 各只發生一次，不因 queue、runner 或 retry 產生重複檔案。
- [ ] background delegate 經 coordinator 完成時，parent thread 只收到一則 completion，execution Archive 只有一筆 linkable record。
- [ ] queue overflow、restart recovery、attachment 與 delegate scenario 均透過同一 public seam 驗證。
