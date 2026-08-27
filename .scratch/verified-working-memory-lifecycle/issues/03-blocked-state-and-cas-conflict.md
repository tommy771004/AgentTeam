# 03 — Blocked state 與 CAS revision conflict

**What to build:** 讓 Agent 能把無法前進的 goal 提交為具體 blocked 狀態，同時以 optimistic concurrency 保護並行或延遲的 State Proposal，避免舊 revision 覆寫新進度。

**Blocked by:** 02 — Execution evidence 驗證 goal completion

**Status:** 已完成

- [x] Checker 可將 pending goal 轉為 blocked，且 blocker 是 bounded、可呈現、可在後續 run 使用的具體理由。
- [x] 每個 State Proposal 必須聲明 base revision；缺少、future 或 stale revision 不得直接提交。
- [x] 兩個 proposal 從相同 revision 出發時，第一個有效 commit 推進 revision，第二個只能被拒絕或依明確規則 rebase，不能 last-writer-wins。
- [x] Rebase 只保留仍適用且 evidence identity 未變的更新；衝突 goal 維持最新 Host state。
- [x] pending、done、blocked transition matrix 對非法逆轉與缺乏 evidence 的 reopen 行為 fail closed。
- [x] Turn Record 與 Host response 能區分 accepted、rejected 與 rebased proposal，且不洩漏 unbounded observation body。
- [x] 並行 proposal smoke 經 public Host seam 驗證 revision 單調與無資料遺失，並已加入實際 smoke gate。
