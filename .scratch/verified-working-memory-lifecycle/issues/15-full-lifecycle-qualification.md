# 15 — 完整 lifecycle qualification 與 drift guards

**What to build:** 用一條真實 Host workflow 證明整個 Verified Working Memory lifecycle 可以交付：Task run admission 建立 state、Skill 在正確事件載入、工具只執行允許的 call、Checker 以證據提交進度、compaction/restart 與 delegation 保真、candidate 只有通過 gate 才啟用。

**Blocked by:** 06 — Delegated goal 的 parent-owned completion; 09 — Skill preflight retry 與 parallel batch barrier; 11 — Component-local candidate、activation 與 rollback; 12 — Memory-Control evaluation promotion gate; 13 — Builtin、External CLI 與 plain-browser capability honesty; 14 — Meta-Agent 只產生 candidate

**Status:** resolved

- [x] End-to-end qualification 從 canonical Task run ingress 啟動，不直接呼叫 lower-level dispatch 或另造 test-only lifecycle。
- [x] Workflow 包含 multi-goal state、Skill redraft、成功與拒絕 Checker、parallel delegation、compaction、Host restart、resume 與 final settlement。
- [x] 同一 Turn Record 能回答 pending work、governing package、Skill selection、實際 tool effect、Checker evidence 與每次 state revision。
- [x] Candidate source failure 被修復且 held-out anchors 保持綠，才可在下一個新 run 觀察到 activated revision；既有 run 不漂移。
- [x] Qualification 明確證明 durable-memory SQLite schema、migration、CRUD、export/import 與 Learning/Settings projection 未被此 effort 接管或平行實作。
- [x] Source drift guards 阻止第二 Working State authority、第二 Pi timeline、model/child direct completion、compatibility-loop production ownership與未 gated smoke。
- [x] 所有本 effort 新增的 smokes 均由實際 `npm run smoke` 或其 production packaging gate 執行並為綠。
- [x] Qualification evidence 與 tracker 狀態可在一 hop 內查核；只有上述證據完整時本票與 effort 才能 resolved。
