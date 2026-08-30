# 07 — External CLI durable lifecycle contract integration

**What to build:** 將既有 External CLI session seam 的 deadline、wait、reconnect、cancel 與 checkpoint evidence 接回 canonical Task run lifecycle，同時保持 provider 自己擁有內部 tool loop。

**Blocked by:** 05 — Finalization claim retry、release 與 drain；external-cli-durable-harness #01–#06

**Status:** 可交給代理

- [ ] startup、idle、absolute、operation 與 yield clocks 各自有明確 owner，不使用單一全域 timeout 冒充全部政策
- [ ] wait-for-user、wait-for-approval、wait-for-auth、yield/reconnect、cancel 與 process loss 形成 typed lifecycle state
- [ ] resume 只在 provider identity 與 replay-safe checkpoint 同時成立時提供；其他狀況明確 interrupted 或 manual retry
- [ ] provider process success 只形成 external outcome，永遠不自動轉成 DoD met
- [ ] event cursor、one settlement、restart recovery 與 unsupported resume 有 deterministic shipped-module evidence
