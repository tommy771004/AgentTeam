# 03 — 讓 external CLI 共用 coordinator lifecycle

**What to build:** 使用者選擇 external CLI runner 時，CLI 仍保有「外部 CLI 執行」的誠實 capability outcome，但 admission、thread presentation、finalization、Archive、release、`onSettled` 與 queue drain 和 built-in run 完全一致。

**Blocked by:** 01 — 建立 coordinator-owned Task run contract；02 — 統一 denial、exception、cancel 的唯一 finalization

**Status:** resolved

- [x] external CLI execution 由 coordinator 建立並傳遞 immutable run snapshot。
- [x] CLI success 不宣稱 built-in DoD/iterate/continueGoal capability；既有 runner matrix 與 UI copy 保持誠實。
- [x] CLI success、CLI failure、CLI cancel 各只完成一次 Archive、`onSettled`、release 與 drain。
- [x] CLI stream、activity、stop 與 terminal summary 以相同 `runId`/`threadId` 對應。
- [x] built-in 與 CLI 的 lifecycle scenario assertions 共用同一個 `runTask` seam。
