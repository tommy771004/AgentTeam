# 18 — Evaluation command 與 release gate 分離

**What to build:** evaluation harness 保留正式、獨立的 operator entry，但不混入 deterministic release smoke；其結果來自既有 journal/artifact references，且不被當成產品 qualification。

**Blocked by:** 01 — Frozen baseline 與 owner evidence index；17 — Headless lifecycle boundary；harness-gap-closure #11 決議

**Status:** 可交給代理

- [ ] evaluation 有一個明確獨立 command，從 deterministic smoke、CI smoke 與 gap-closure gate 移出
- [ ] evaluation 讀取受治理的 run journal、artifact reference與bounded evidence，不建立旁路 telemetry
- [ ] deterministic smoke 仍守住 evaluation ownership與非 release-gate邊界
- [ ] package scripts、tracker、qualification與操作文件對 evaluation status 使用一致語意
- [ ] evaluation failure 不改寫 build/smoke 結果，release evidence 也不以 evaluation fixture 代替
