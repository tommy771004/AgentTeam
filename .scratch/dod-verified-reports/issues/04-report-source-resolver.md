# 04 — runId↔thread↔archive join resolver

**What to build:** 給定 journal 條目、archive 記錄與 threads（參數注入，不讀 store），resolver 產出「單一 run 的報告來源束」：生命週期 metadata（journal）＋證據主體（archive）＋diff/plan/agents/operations（thread 摘要），並標記缺件（例如無 archive 記錄時的降級）。retry 來源 runId 鏈一併解析。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 純函數：輸入三份資料，輸出 ReportSourceBundle（含缺件標記）
- [x] retry/continue 來源鏈解析（沿 journal 來源欄位回溯）
- [x] smoke：齊件、缺件降級、CLI run（external 標記）、retry 鏈各案

## Answer

`src/agent/reportSource.ts` `resolveReportSource({runId, journal, archive, threadSummaries})`：輸出 ReportSourceBundle（lifecycle/archive/threadSummary/lineageRunIds/runnerKind/degraded 缺件標記）。血緣設計：journal 無 parent 欄位，但重跑一律 reuseThread——同 threadId 的 run 條目時序即任務史鏈（去重）。runnerKind 由 archive.externalRun 推導（外部 CLI）。smoke 第 4 組：齊件、三缺件全標、CLI external 標記、retry 血緣含前後 run。
