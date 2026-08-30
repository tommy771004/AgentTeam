# 10 — Content publish intent 進入 Task run lifecycle

**What to build:** 內容發布排程成為 durable publish intent，到期時經過 trigger validation、capacity、queue 與 coordinator admission；renderer 不再直接呼叫 production publish API。

**Blocked by:** 09 — Host-owned ScheduledJob due claim

**Status:** 可交給代理

- [ ] publish schedule 與 Host-owned scheduled/delivery record 共享明確 identity 與 idempotency key
- [ ] 到期 publish 透過唯一 run ingress，保存 project、media、platform、approval 與 unattended snapshot
- [ ] renderer store 只建立/投影 intent，不直接執行 production adapter 或 browser publish
- [ ] plain-browser 模式明確 unsupported，不以 fallback 偽裝 production success
- [ ] create→due→claim→queue→admit 與 cancellation/reload 有端到端 smoke
