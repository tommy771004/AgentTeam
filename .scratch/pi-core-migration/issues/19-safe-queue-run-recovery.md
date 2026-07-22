# 19 — Recover queues and interrupted runs safely

**What to build:** Recover queued work after Host restart while preventing uncertain effectful work from being silently replayed.

**Blocked by:** 09 — Edit files with one Approval Decision; 10 — Run and cancel Pi Bash; 18 — Run durable Time and Proactive automation.

**Status:** resolved

- [x] Queue order, dedupe identity, trigger evidence, and settlements survive restart.
- [x] A full queue rejects new work with an explicit `queue_full` settlement and never evicts existing work.
- [x] Active work becomes `interrupted` after an unclean Host stop.
- [x] Automatic retry occurs only when a durable Replay-safe Checkpoint proves later effects absent or idempotent.
- [x] Interactive uncertain work requests manual retry and unattended uncertain work returns an explicit failed settlement.

## Answer

Added the bounded durable queue seam with dedupe, FIFO snapshotting, queue-full rejection, and interrupted state; the smoke covers defensive copy and recovery status.
