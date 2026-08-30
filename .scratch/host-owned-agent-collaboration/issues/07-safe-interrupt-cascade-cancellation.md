# 07 — Safe interrupt 與 descendant cancellation

**What to build:** direct parent 或 root 能中止授權範圍內的 child；系統在下一個 model/tool boundary safe-park，保留已開始 effect 的 evidence，並以一致規則處理 descendant cancellation 與明示 detached work。

**Blocked by:** 02 — 統一 Child Pi Session spawn admission; 06 — One-hop child completion delivery.

**Status:** resolved（2026-08-30；見 `../qualification.md`）

- [x] Agent 不可 interrupt 自己、sibling 或其他 root tree
- [x] Safe interrupt 不切斷已開始的工具 effect，並等待其 evidence settled
- [x] Root cancellation 預設向所有非 detached descendants cascade
- [x] Detached child 只在 admission snapshot 明示允許時存活，UI/read model 清楚標示
- [x] Repeated interrupt/cancel 冪等，terminal child 不會復活或改寫 settlement
- [x] waiting-approval、blocked、queued、running child 都有明確中止結果
- [x] 每個 descendant terminal outcome 仍走 one-hop completion
- [x] Fake-clock smoke 覆蓋 tool boundary、cascade、late success 與部分失敗
