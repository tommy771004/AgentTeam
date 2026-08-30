# 06 — Follow-up 重啟恢復與投影去重

Spec: `../spec.md`

**What to build:** 讓 accepted follow-ups 在 renderer reload、cursor replay 與 Pi Host restart 後仍以相同 identity、順序、frozen action 與安全附件 metadata 重建 pending cards。Host snapshot 加 cursor events 是唯一恢復來源；transport retry 與重疊 replay 不產生重複卡片，cancelled／settled items 不復活，effectful active run 中斷時仍遵守 Replay-safe Checkpoint 政策而不把它偷偷重排成新任務。

**Blocked by:** 04 — Queue 卡片編輯、刪除與重新排序; 05 — Steer 競態與拒絕恢復.

**Status:** 可交給代理

- [ ] Accepted queue items 存入既有 Host canonical snapshot/journal，Host restart 後 identity、FIFO order、revision 與 frozen submission facts 不變
- [ ] Renderer reload 從 snapshot 加 events-after-cursor 重建卡片，不把 renderer localStorage 推回 Host 或參與 two-way merge
- [ ] Snapshot/event overlap、transport retry 與相同 client identity 恰好投影一張卡片；相同文字不同 identity 仍投影多張
- [ ] Edit、reorder 與 cancel 的最新 Host revision 在 reload 後維持，較舊事件不能回滾或復活 terminal item
- [ ] Accepted steer 的短暫投影在 Host 能證明時恢復；不能證明已接受時誠實降級，不從 transcript 猜測
- [ ] Active effectful run 在 Host restart 後依既有政策成為 interrupted；沒有 Replay-safe Checkpoint 時不自動 retry，也不自動轉成 queue head
- [ ] Interrupted run 的未來 queued items 保持 queued，直到合法 recovery／terminal settlement boundary 才能釋放
- [ ] Restart black-box 與 rendered hydration smoke 覆蓋 duplicate event、stale event、cancel tombstone、frozen capability、附件 metadata 與 interrupted safety

