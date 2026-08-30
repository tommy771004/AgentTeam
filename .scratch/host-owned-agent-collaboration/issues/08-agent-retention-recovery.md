# 08 — Agent retention、ack、close 與 recovery

**What to build:** Agent tree、mailbox、terminal result 與 acknowledgement 在 renderer reload 和 Host restart 後可恢復；active agent 不被逐出，terminal agent 依 ack、explicit close、TTL 與 count cap 有界保留。

**Blocked by:** 06 — One-hop child completion delivery; 07 — Safe interrupt 與 descendant cancellation.

**Status:** resolved（2026-08-30；見 `../qualification.md`）

- [x] Active agents 與未 ack terminal mail 不因 renderer reload 消失
- [x] Host restart 重建 tree edge、lifecycle、mailbox delivery/consumption/ack 與 terminal result reference
- [x] Persisted active work若無 live witness 會誠實 recovery/interrupt，不偽造仍在 running
- [x] Ack 與 close 冪等，close terminal agent 後釋放 retained capacity
- [x] TTL/count cleanup 永不逐出 active agent 或尚未安全交付的 result
- [x] Completed child 在 retention window 內仍可被 authorized follow-up reuse
- [x] Snapshot + cursor 合併不重複 message、completion 或 UI row
- [x] Restart/reload E2E 使用可觀察狀態而非固定 sleep
