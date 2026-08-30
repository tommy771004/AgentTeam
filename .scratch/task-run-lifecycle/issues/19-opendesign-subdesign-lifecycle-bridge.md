# 19 — OpenDesign／SubDesign provider lifecycle bridge

**What to build:** OpenDesign 與 SubDesign 的 provider、interactive surface、streaming artifact 與 fallback 都成為 canonical Task run 的受治理 stage，而不是獨立 runtime 或 iframe-owned truth。

**Blocked by:** 06 — Host ToolOutputSpillStore 單一 authority；07 — External CLI durable lifecycle contract integration；11 — Host publish adapter evidence 與 unknown recovery；12 — Webhook、Telegram、event、delegate durable delivery；13 — Outward-effect policy 與 evidence contract；既有 OpenDesign #01–#09 與 subdesign-architecture-deepening #05

**Status:** 可交給代理

- [ ] provider contract、resolved snapshot、grant、pin/version/license與integrity 沿 admission snapshot 固定
- [ ] interactive input、streaming artifact、cursor replay、cancel與late event 使用 sandboxed Host bridge與schema validation
- [ ] provider/iframe failure 有 native fallback，必要 input 不會因 surface failure 被略過
- [ ] artifact、evidence、settlement與DoD分離；provider success 不自動等於設計工作完成
- [ ] success、blocked、failed、cancelled、DoD-unmet 與 reload/restart replay 有端到端 evidence
