# 07 — Goal lifecycle persistence 與 exactly-once finalization

**What to build:** 讓 terminal Goal facts 穿越 attachment、journal、reload 與 app finalization recovery，同時保持 Goal truth 與 exactly-once app effects 各自獨立。

**Blocked by:** 06 — Criterion-driven repair loop.

**Status:** ready-for-agent

- [ ] Terminal attachment 保存 execution settlement、Goal verdict、contract digest 與 acceptance digest。
- [ ] Finalization claim、complete、ack 不可改寫 Host 已簽發的 Goal truth。
- [ ] Execution terminal 後、app finalization 前 crash 可恢復且 app effects 僅執行一次。
- [ ] Legacy journal 採保守 mapping，缺少 DoD proof 時顯示 legacy-unverified。

