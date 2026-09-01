# 12 — Fresh semantic verifier

**What to build:** 讓 semantic criteria 由獨立 fresh-context verifier 驗證，僅讀取受政策約束的 artifacts、criteria、evidence refs 與 rubric。

**Blocked by:** 05 — 擴充 deterministic criteria; 10 — Fan-out／fan-in scheduler.

**Status:** ready-for-agent

- [ ] Verifier request 不含 worker transcript、provider history 或 reasoning。
- [ ] Sanitized artifact projection 仍經 Outbound Data Gate，fresh context 不繞過 policy。
- [ ] Correctness、freshness 與 source validity 可平行執行，quorum deterministic。
- [ ] Mandatory criterion 不可被 majority 覆蓋，verifier cost 計入 Goal budget。

