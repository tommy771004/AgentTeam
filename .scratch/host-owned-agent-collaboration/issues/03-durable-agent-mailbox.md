# 03 — Durable queue-only agent mailbox

**What to build:** 同一 agent tree 中的 parent、child 與 sibling 能傳送 bounded informational message。訊息只排入 receiver mailbox、不自行啟動 turn，並具備 durable delivery、consumption、ack、dedupe 與可稽核 Turn Record。

**Blocked by:** 02 — 統一 Child Pi Session spawn admission.

**Status:** resolved（2026-08-30；見 `../qualification.md`）

- [x] Queue-only send 在 receiver idle/running 時都不啟動新 Task run
- [x] Parent↔child 與 sibling informational message 可送達，跨 tree delivery fail closed
- [x] Sibling 不可藉 message 取得 follow-up、interrupt、close 或 write-authority 控制權
- [x] Message envelope 有穩定 identity、sender/receiver/tree/turn/run attribution、kind 與 bounded content
- [x] 重送相同 message 不會重複投遞，delivery、consumption、ack 分開記錄
- [x] Mailbox/Turn Record 不保存 raw credentials 或完整 parent transcript
- [x] Queue 上限回傳明確失敗且不逐出舊訊息
- [x] Renderer reload 與 replay 顯示同一組 ordered message events
