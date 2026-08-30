# 04 — Follow-up task 與 profile continuity

**What to build:** 授權 parent 可對既有 child 派送新的 follow-up。idle child 會啟動一個新 Task run；running child 在 model/tool 安全邊界接收，維持 FIFO、同 session 序列化與原 Effective Agent Profile。

**Blocked by:** 03 — Durable queue-only agent mailbox.

**Status:** 可交給代理

- [ ] Idle child 的 follow-up 恰好啟動一個經 coordinator admission 的 Task run
- [ ] Running child 在安全邊界接收，不中途切斷 effect 或建立同 session 的第二個 active run
- [ ] 多筆 follow-up 按 Host-authored FIFO 順序執行
- [ ] Direct parent/root 可派工，sibling 與跨 tree caller 被拒絕
- [ ] Child model、approval、sandbox、capabilities 與 permission profile 跨 turn 保持連續且只允許更嚴更新
- [ ] Delivery 失敗不遺失訊息，也不把未開始的 turn 標成 running
- [ ] Follow-up lifecycle 全部進入 Turn Record 與 agent read model
- [ ] Focused smoke 覆蓋 idle、running、queue、duplicate 與 policy continuity
