# 16 — Run Review end-to-end qualification

**What to build:** 在不重做已完成基礎能力的前提下，驗證一次完整 Run Review lifecycle：feedback 產生新 run 與 snapshot B，歷史 A 保持 immutable，所有 comment、verification、Git 與 recovery state 可重播。

**Blocked by:** 15 — Run Review feedback 與 mutation lifecycle integration；run-review-workspace #15

**Status:** 可交給代理

- [ ] feedback→new run→snapshot B 保留原始 source、thread ordering、claim 與 delivery lineage
- [ ] A/B comments、reviewed state、verification與artifact references 在 reload/restart 後一致
- [ ] stale CAS 不產生部分 Git side effect，failure receipt 可查且不覆寫歷史 snapshot
- [ ] commit/push/PR approval與evidence可重跑，未知 remote outcome 不自動重送
- [ ] qualification report 指向 shipped smoke、Electron E2E、baseline 與任何外部 blocked evidence
