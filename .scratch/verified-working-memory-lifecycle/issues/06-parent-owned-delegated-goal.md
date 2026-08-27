# 06 — Delegated goal 的 parent-owned completion

**What to build:** 讓 Manager 將單一 goal 的唯讀 snapshot 委派給 child session；child 回傳 observation 與 evidence references 後，由 parent Host Checker 決定父 goal 是否完成。

**Blocked by:** 03 — Blocked state 與 CAS revision conflict

**Status:** 已完成

- [x] Child session 只收到 assigned goal、必要 constraints 與 base revision，不取得或持有可變的 run-wide ledger。
- [x] Child 的完成文字、assistant settlement 或本地 state claim 不能直接修改 parent Working State。
- [x] Child 回傳的 evidence reference 必須綁定 parent run、assigned goal 與可驗證 Host record identity。
- [x] Parent Checker 接受有效 evidence 後才提交父 goal；無效、缺漏或跨 goal evidence 保持 pending 或 blocked。
- [x] 兩個 child 使用相同舊 revision 回報時，CAS 規則避免互相覆寫，並清楚記錄 reject 或 rebase。
- [x] Delegation record 可稽核 assignment、observation、check 與 parent commit，而不建立 child-owned canonical timeline。
- [x] 真實 parent/child Host smoke 覆蓋成功、false claim 與 stale race，並已加入實際 smoke gate。
