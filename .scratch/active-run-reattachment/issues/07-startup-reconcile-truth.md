# 07 — `reconcileStartup` 先問再標

Status: resolved
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

`runJournal.reconcileStartup()` 目前無條件把所有 `admitted` / `running` / `dispatching` 的 entry 標成 `interrupted`——它假設 renderer 的死亡等於 run 的死亡。Pi Core Host 跑在 main 監督的 utility process,**這個假設是錯的**,所以 journal 現在會對一個仍在執行的 run 說謊。

改為:先向 Pi Core Host 取得仍被認得的 active run 集合(04 提供),只有**不在集合裡**且沒有 Host terminal attachment 的才標 interrupted；已有 terminal attachment 的 entry 交給 06 app finalization,不得降格成 interrupted。

查詢不可用時(plain browser、bridge 缺席)維持現行行為——那個情況下 renderer 的死亡確實等於 run 的死亡,標 interrupted 是正確的。

同時在模組註解寫清分工:`runJournal` 維持 local-first 的**投遞追蹤**(`pending-delivery` / `consumed` 那套不動),它**不是**重新附著的真相來源;真相是 Pi Core Host attachment journal 與同一 Host 的 Turn Record。

## Acceptance criteria

- [x] 仍被認得的 active run 不再被標成 `interrupted`
- [x] 不被認得的 run 仍標 `interrupted`(誠實中斷回報未流失)
- [x] bridge 缺席／plain browser 時維持現行行為
- [x] `pending-delivery` / `consumed` 投遞語意不變,不重複敘述也不漏敘述
- [x] 模組註解寫明 journal 非真相來源
- [x] `smoke-run-journal`、`smoke-run-journal-durability` 延伸後全綠

## Blocked by

04 — attach / ack 介面 + preload

## Implementation evidence (2026-08-26)

- `reconcileStartup(hostTruth)` preserves Host-known active and terminal run IDs while retaining the old fail-safe for a missing bridge; a present-but-unreachable Host leaves reconciliation locked rather than fabricating interruption.
- `smoke-run-journal.mts` and `smoke-run-journal-durability.mts` passed, including delivery semantics and corrupted-state recovery.
