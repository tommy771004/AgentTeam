# 13 — Outward-effect policy 與 evidence contract

**What to build:** 每一類 outward effect 都有一致且可查的 approval、Outbound Gate、idempotency、trusted evidence 與 recovery 規則，模型文字、tool args 或 CLI exit code不能自行證明 effect。

**Blocked by:** 06 — Host ToolOutputSpillStore 單一 authority；07 — External CLI durable lifecycle contract integration；11 — Host publish adapter evidence 與 unknown recovery；12 — Webhook、Telegram、event、delegate durable delivery

**Status:** 可交給代理

- [ ] message send、MCP、workspace write、Git mutation、merge/push、deploy、publish 與 External CLI effect 全部有明確 policy classification
- [ ] trusted adapter/Host receipt 是唯一 effect evidence；planned/model/approval/process-success state 不可升格
- [ ] unknown、partial、denied、cancelled 與 interrupted outcome 各有安全 retry/refusal 行為
- [ ] large evidence body 使用 Host locator，renderer/journal 只保存 bounded provenance
- [ ] drift guard 阻止新 effect 旁路 approval、Outbound Gate、evidence 或 idempotency owner
