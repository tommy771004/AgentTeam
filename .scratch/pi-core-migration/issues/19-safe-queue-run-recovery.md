# 19 — Recover queues and interrupted runs safely

**What to build:** Recover queued work after Host restart while preventing uncertain effectful work from being silently replayed.

**Blocked by:** 09 — Edit files with one Approval Decision; 10 — Run and cancel Pi Bash; 18 — Run durable Time and Proactive automation.

**Status:** 可交給代理

- [ ] Queue order, dedupe identity, trigger evidence, and settlements survive restart.
- [ ] A full queue rejects new work with an explicit `queue_full` settlement and never evicts existing work.
- [ ] Active work becomes `interrupted` after an unclean Host stop.
- [ ] Automatic retry occurs only when a durable Replay-safe Checkpoint proves later effects absent or idempotent.
- [ ] Interactive uncertain work requests manual retry and unattended uncertain work returns an explicit failed settlement.
