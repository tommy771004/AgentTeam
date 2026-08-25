# 07 — Interaction 與 planning pack：ask_user、update_plan

**What to build:** agent 卡住需要問使用者時，問題真的送到使用者面前，而不是讓 run 停在那裡；agent 更新計畫時，畫面上那個計畫面板跟著動 —— 而不是 agent 心裡一份、UI 一份。

**Blocked by:** 01

**Status:** 可交給代理

- [x] `ask_user` 註冊為 extension tool，觸發與其他核准同一條 HITL 路徑
- [x] unattended run 依既有 timeout 政策自動拒絕（45s unattended / 90s interactive），不會無限等待
- [x] `update_plan` 驅動使用者看得到的計畫面板；模型的計畫與 UI 的計畫是同一份
- [x] 計畫快照隨 run 留存，可重播
- [x] Turn Record 留下對應項目
- [x] 測試在單一接縫，含 unattended 自動拒絕路徑
