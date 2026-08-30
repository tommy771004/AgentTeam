# 21 — Runtime owner 文件與 tracker 收口

**What to build:** 現行文件、tracker、qualification 與 package commands 對 Task run owner、完成度及阻塞狀態使用同一套事實；已刪 runtime 不再被描述為可實作 seam。

**Blocked by:** 08 — External CLI provider qualification matrix；13 — Outward-effect policy 與 evidence contract；16 — Run Review end-to-end qualification；18 — Evaluation command 與 release gate 分離；19 — OpenDesign／SubDesign provider lifecycle bridge；20 — Adaptive run status canonical projection

**Status:** 可交給代理

- [ ] active guidance 清除 deleted engine、loop、runExternal、renderer scheduler與direct publish owner 敘述；歷史比較明確標示 historical
- [ ] app queue、Host turn queue、scheduler、artifact、spill、Git、token與status authority 邊界一致
- [ ] INDEX、DEV_STATE、相關 effort tickets 與 qualification reports 同步，resolved 有一 hop gate evidence
- [ ] qualified、blocked-auth、unavailable、unsupported 與未完成 implementation 分開列示
- [ ] tracker link guard、documentation drift guards 與 deterministic smoke 全綠
