# 04 — Integrations pack 補齊：web_search、message_send

**What to build:** 使用者請 agent 做一件需要查資料的事，agent 真的查得到；請它送一則通知，通知真的送得出去。今天這兩個工具在 production 都叫不動，研究類任務被靜默降級成憑空猜測。

沿用 01 建立的形狀。`http_fetch` 已經在 01 落地，這張票把 Integrations pack 補完。

**Blocked by:** 01

**Status:** 可交給代理

- [x] `web_search` 與 `message_send` 以 `pi.registerTool()` 註冊在 Integrations pack
- [x] 兩者在真的 turn 裡可被呼叫並回傳結果
- [x] 走同一套 Approval Decision 與 Outbound Data Gate
- [x] `tools/list` 回報它們與所屬 pack
- [x] Turn Record 留下座標正確的 tool-call / tool-result
- [x] 測試在單一接縫
