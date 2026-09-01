# 14 — Review、UI、metrics 與整體 qualification

**What to build:** 讓使用者與 release qualification 清楚看見 execution、Goal、Workflow 與 app finalization 的獨立狀態，並以完整測試矩陣證明 migration 與 recovery 語意。

**Blocked by:** 01 — 統一 Pi iteration contract; 02 — 擴充正交 Outcome vocabulary; 03 — Goal Contract admission 與 fail-closed; 04 — Acceptance Gate 首條完整路徑; 05 — 擴充 deterministic criteria; 06 — Criterion-driven repair loop; 07 — Goal lifecycle persistence 與 exactly-once finalization; 08 — Workflow Graph contract 與 admission validator; 09 — 單節點 Workflow Record tracer; 10 — Fan-out／fan-in scheduler; 11 — Node retry 與 impacted-subgraph repair; 12 — Fresh semantic verifier; 13 — Checkpoint／resume／crash recovery.

**Status:** ready-for-agent

- [ ] UI 區分 model answered、checking、passed、failed、blocked、unverifiable、exhausted 與 finalization recovery。
- [ ] Metrics 對 execution、Goal、criteria、workflow、verifier 與 finalization 使用具 denominator 的 truth-preserving counters/rates。
- [ ] Legacy protocol、journal、Turn Record 與 WorkingState 可保守讀取，新 runs 僅寫新格式。
- [ ] 規格列出的 30 項 Goal、Graph、Verifier、Lifecycle qualification 全部通過且文件 vocabulary 同步。

