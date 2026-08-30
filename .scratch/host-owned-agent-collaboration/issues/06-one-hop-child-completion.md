# 06 — One-hop child completion delivery

**What to build:** 每個 child terminal outcome 都恰好一次送到 direct parent mailbox，喚醒等待中的 parent，並綁定 spawn 它的原始 Chat turn。Generic result 可供整合，但不會自動推進 Verified Working State。

**Blocked by:** 03 — Durable queue-only agent mailbox; 05 — Event-driven wait 與 mailbox wake-up.

**Status:** 可交給代理

- [ ] completed、failed、cancelled、interrupted 都產生 bounded terminal result 與 stable result reference
- [ ] Result 只自動投遞 direct parent，不跳過 nested parent 注入 root
- [ ] Parent wait 被 terminal mail 喚醒，idle parent 仍保留未 consumption result
- [ ] Duplicate settlement/recovery 不產生第二份 completion message
- [ ] Late completion 保持 originating Chat turn attribution，不顯示成下一輪 active progress
- [ ] Generic result 明確標成 observation，沒有 Checker evidence 時不改 Working State
- [ ] Parent 可用 explicit relay 將整合後結果向上一層回報
- [ ] Protocol smoke 覆蓋 direct child、grandchild、parent already terminal 與 renderer reload
