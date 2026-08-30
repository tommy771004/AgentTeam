# 09 — Host-owned ScheduledJob due claim

**What to build:** 到期排程由 Host/main 原子 claim 並以同一 identity 進入 coordinator；App 關閉、renderer reload 或 duplicate tick 都不會漏跑或重複 dispatch。

**Blocked by:** 05 — Finalization claim retry、release 與 drain

**Status:** 可交給代理

- [ ] Host/main 是唯一 due consumer，renderer ticker 只顯示 projection 或提交 intent
- [ ] claim、advance、idempotency key、trigger snapshot 與 schedule admission 具有一致 receipt
- [ ] duplicate tick、renderer reload、Host restart 與 capacity overflow 不會讓同一 occurrence 被兩個 owner claim
- [ ] queued schedule 保留 unattended、原始 trigger 與 delivery intent，不在 drain 時重新 mint evidence
- [ ] schedule 建立至 settle/recovery 的 shipped-module smoke 使用同一 run/occurrence identity
