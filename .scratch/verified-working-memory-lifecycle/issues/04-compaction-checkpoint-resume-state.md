# 04 — Compaction、checkpoint 與 resume 保留 Working State

**What to build:** 讓 multi-goal run 經 context compaction、Host restart 與 replay-safe resume 後，繼續使用同一份 verified Working State，而不是重新從 transcript 猜測進度或重做已完成副作用。

**Blocked by:** 03 — Blocked state 與 CAS revision conflict

**Status:** 已完成

- [x] Compaction Manifest 由最後 committed Working State 投影 objective、constraints、goals、blockers 與 completed effect identities。
- [x] Transcript heuristic 只服務沒有 verified state 的 legacy session，且不能回寫 canonical Working State。
- [x] Checkpoint 記錄捕捉時的 Working State revision；resume 對缺失、mismatch 或非 replay-safe state fail closed。
- [x] Host restart 後能由 durable session record 與 checkpoint 恢復相同 state revision，不依賴 renderer cache。
- [x] Resume 不重播 checkpoint 前已完成的 side effects，也不把 pending 或 blocked goal 誤標 done。
- [x] Compaction、resume 與 replay 產生的 Working State projection 在內容與順序上相同。
- [x] 真實 restart smoke 強制跨過 compaction boundary 並驗證狀態與 effect identities，且已加入實際 smoke gate。
