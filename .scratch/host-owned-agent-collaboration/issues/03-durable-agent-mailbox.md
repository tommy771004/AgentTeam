# 03 — Durable queue-only agent mailbox

**What to build:** 同一 agent tree 中的 parent、child 與 sibling 能傳送 bounded informational message。訊息只排入 receiver mailbox、不自行啟動 turn，並具備 durable delivery、consumption、ack、dedupe 與可稽核 Turn Record。

**Blocked by:** 02 — 統一 Child Pi Session spawn admission.

**Status:** 可交給代理

- [ ] Queue-only send 在 receiver idle/running 時都不啟動新 Task run
- [ ] Parent↔child 與 sibling informational message 可送達，跨 tree delivery fail closed
- [ ] Sibling 不可藉 message 取得 follow-up、interrupt、close 或 write-authority 控制權
- [ ] Message envelope 有穩定 identity、sender/receiver/tree/turn/run attribution、kind 與 bounded content
- [ ] 重送相同 message 不會重複投遞，delivery、consumption、ack 分開記錄
- [ ] Mailbox/Turn Record 不保存 raw credentials 或完整 parent transcript
- [ ] Queue 上限回傳明確失敗且不逐出舊訊息
- [ ] Renderer reload 與 replay 顯示同一組 ordered message events
