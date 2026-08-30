# 01 — Frozen baseline 與 owner evidence index

**What to build:** 建立一份可重跑、可一 hop 查核的 Task run baseline，固定 checkout、工作樹歸屬、runtime owner 與 gate 結果，讓後續 tickets 不會在不同時間點或不同 WIP 上誤判現況。

**Blocked by:** None — can start immediately

**Status:** 可交給代理

- [ ] 記錄 commit boundary、tracked/untracked ownership 與不屬於本 effort 的既有 WIP，且不覆寫其他工作
- [ ] 將 source、ADR、tracker、qualification 與 package command 的現況整理成單一 evidence index
- [ ] build、lint、deterministic smoke 與 diff check 均對應同一 baseline；失敗項有明確 blocker，不被宣稱為綠
- [ ] 已完成、尚缺 implementation、尚缺 evidence 與外部 qualification 四種狀態分開記錄
