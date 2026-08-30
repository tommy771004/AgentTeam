# 12 — Webhook、Telegram、event、delegate durable delivery

**What to build:** 非 content-publish 的外部來源與回傳目的地使用 durable delivery intent；renderer 消失後仍能完成 bookkeeping 或交付已保存結果，而不重新執行原工作。

**Blocked by:** 05 — Finalization claim retry、release 與 drain

**Status:** 可交給代理

- [ ] webhook、Telegram、event 與 delegate request 保存 bounded inbound identity、provenance、destination 與 dedupe key
- [ ] queue、reload 與 Host restart 後能由 snapshot 重建 delivery，不依賴消失的 function callback
- [ ] event matcher evidence 與 delegate lineage 沿 queue/recovery 保存；缺失時 fail closed
- [ ] delivery retry 只敘述已保存 terminal outcome，不能重新執行 tool loop 或 side effect
- [ ] duplicate inbound、missing owning thread、disabled delegate 與 pending delivery 有可重跑 smoke
