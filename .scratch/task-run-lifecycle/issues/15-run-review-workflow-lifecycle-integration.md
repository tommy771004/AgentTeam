# 15 — Run Review feedback 與 mutation lifecycle integration

**What to build:** 既有 Run Review #10–#14 的 feedback、verification、Git mutation 與 retention workflow 全部沿用 admission snapshot、stage ledger、approval、evidence 與 recovery，不建立第二套 run owner。

**Blocked by:** 14 — Canonical review diff fail-closed；run-review-workspace #10–#14

**Status:** 可交給代理

- [ ] feedback/comment bundle 在 claim 與 admission 時凍結，same-thread ordering、retry、cancel、reload 只消費一次
- [ ] verification 結果綁 snapshot/revision與Host evidence，workspace 改變後明確 stale
- [ ] stage、unstage、revert 使用 expected revision、preview/approval 與 partial mutation refusal
- [ ] commit、push、PR 分步 idempotent，auth/hook/remote/force failure 有安全 recovery
- [ ] export/import、WAL recovery、collision、tombstone、reference-aware GC 與 hard-delete boundary 接回 lifecycle receipts
