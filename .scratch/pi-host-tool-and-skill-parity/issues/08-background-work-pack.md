# 08 — Background work pack：delegate_task、delegate_status、monitor

**What to build:** 使用者請 agent 把一件大事拆給子 agent 做，它真的拆得下去、也回報得了進度。今天 delegation 是一個「列在清單上但不存在」的功能。

Host 已經有 child session 支援（`sessions/createChild`、`piDelegationExtension`），這張票把模型面向的工具接上去。

**Blocked by:** 01

**Status:** 可交給代理

- [ ] `delegate_task` / `delegate_status` 註冊為 extension tools，走 Host 既有的 child session 路徑
- [ ] child session 帶 role、profile、context、depth，缺任一項 fail closed
- [ ] worktree isolation 的既有行為保持
- [ ] `monitor` 註冊並可回報背景工作狀態
- [ ] 子 run 的 Turn Record 有正確的 parent 關聯
- [ ] 測試在單一接縫：建立 child、查詢狀態、深度上限拒絕
