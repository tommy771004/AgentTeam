# 05 — Event-driven wait 與 mailbox wake-up

**What to build:** agent 在真正需要 child 結果時可等待自己的 mailbox 或 lifecycle notification；新訊息、child terminal 或使用者 steer 立即喚醒，沒有活動才在 bounded deadline 回傳 timeout。

**Blocked by:** 03 — Durable queue-only agent mailbox.

**Status:** resolved（2026-08-30；見 `../qualification.md`）

- [x] Wait 觀察 caller mailbox，不掃描 renderer store 或輪詢 child status
- [x] Message、terminal notification 與 user steer 都能立即結束等待並回傳可區分 outcome
- [x] Timeout 不改變 child lifecycle，也不取消 child
- [x] 已排隊但尚未 consumption 的 mail 會立即滿足下一次 wait
- [x] 多個 child 中任一活動可喚醒 parent，後續 mail 不會被第一個結果吞掉
- [x] Wait 有 Host-enforced min/default/max timeout，取消與 transport error 誠實區分
- [x] Wait activity 使用既有 Turn Record/transport，不建立第二份歷史
- [x] Fake-clock smoke 無 busy polling、固定 sleep 或額外 model turn
