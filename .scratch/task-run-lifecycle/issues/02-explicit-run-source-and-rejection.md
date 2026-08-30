# 02 — Explicit RunSource request 與 pre-admission rejection

**What to build:** 每個 production request 都以明確原始來源進入唯一 coordinator，並在取得 capacity 前一致拒絕無效 request；使用者不會看到未 admitted 工作被偽裝成 execution 或 archive。

**Blocked by:** 01 — Frozen baseline 與 owner evidence index

**Status:** 可交給代理

- [ ] 所有 production ingress 明確提供原始 source kind，不再由 label、callback 或 queue cause 反推來源
- [ ] 空 objective、invalid trigger、duplicate identity、disabled capability 與 malformed review feedback 在 admission 前 typed rejection
- [ ] schedule、event 等外部 claim 即使被拒絕仍有獨立 bookkeeping settlement，不建立假的 run execution
- [ ] source × rejection matrix 由 shipped-module smoke 覆蓋，且 drift guard 阻止 UI 旁路唯一 coordinator
