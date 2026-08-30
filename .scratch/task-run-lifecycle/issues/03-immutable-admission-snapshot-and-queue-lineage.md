# 03 — Immutable admission snapshot 與 queue lineage

**What to build:** admitted 或 queued 工作攜帶同一份 bounded、serializable snapshot；設定、project、trigger、runner 與 delivery identity 在等待或 drain 後仍保持原始語意。

**Blocked by:** 02 — Explicit RunSource request 與 pre-admission rejection

**Status:** 可交給代理

- [ ] admission snapshot 固定 run/thread/project、objective、runner、capability、settings、approval、trigger、delivery 與 idempotency identity
- [ ] queue item 只保存 bounded serializable state，不保存 function callback、token body 或 mutable store reference
- [ ] queue drain 保留原始 source policy，processing cause 不會把 schedule、event 或 delegate 改寫成 interactive source
- [ ] same-thread steer/queue、different-thread concurrency 與 abort wait fallback 不遺失 objective 或重複 mint trigger evidence
- [ ] queue persistence、reload 與 drain smoke 直接 import shipped owner 並驗證 lineage
