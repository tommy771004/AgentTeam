# 09 — Skill preflight retry 與 parallel batch barrier

**What to build:** 讓 Skill preflight 在 transport retry 與 parallel sibling tool calls 下仍維持 exactly-once non-execution/執行語意，不出現一個 call 被攔截而另一個先產生副作用的半批次狀態。

**Blocked by:** 08 — Skill 命中後的 not-executed redraft

**Status:** 完成

- [x] Preflight identity 綁定 run、step、batch、original call 與 Working State revision，重試回傳相同決策。
- [x] 相同 identity 與不同 payload 或 state revision 組合時 fail closed，不重用舊決策。
- [x] 一批 sibling calls 只要任一 call 是 state-changing，所有 sibling 都在任何執行前完成 preflight。
- [x] 任一 sibling 需要 Skill redraft 時，原 batch 不產生部分 side effects，並以明確 Host outcome 結束。
- [x] 全批 pass-through 時仍保留原 call ordering、Approval Decision、tool contract identity 與 settlement。
- [x] Retry、cancel 與 interrupt 不能讓被攔截的 original call 在稍後重新出現並執行。
- [x] 真實 Host concurrency smoke 觀察實際 side effects 而非 mock call counts，並已加入實際 smoke gate。
