# 14 — Durability、並行與 privacy failure matrix

Status: 已解決
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

用跨 workflow failure matrix 驗證所有已遷移的寫入來源具有相同 durability、contention 與 privacy 語意。這張票修補從 tool、automatic learning、admin、clear、Dream、export/import 到 shutdown 的整體缺口，確保沒有某個旁路仍先回成功、漏 sanitizer 或在 concurrency 下破壞資料。

## Acceptance criteria

- [x] tool、explicit/automatic learning、admin edit/delete/clear、Dream 與 import 都符合 commit-before-success；export 使用一致 snapshot
- [x] immediate process kill after acknowledgement 再啟動時，每種 acknowledged mutation 都存在且沒有 duplicate
- [x] disk-full、read-only、busy timeout、forced close 與 transaction fault 對所有 write origins 都不回 success、不發布 success revision
- [x] 兩個 Host process 競爭同一 DB 時 uniqueness、operation idempotency、busy handling 與 revision 保持有效，DB integrity 不受損
- [x] sanitizer/validation/quota 無法由 import、consolidation、special-entry Settings 或 legacy bridge 繞過
- [x] revision/activity/Turn Record/audit/error payload 不包含不必要 memory text、credential 或 deleted content
- [x] hard delete 後依 09 contract 執行 checkpoint/平台能力，測試與產品文案不把 plaintext SQLite 說成 encrypted
- [x] failure matrix 掛入主 smoke chain並可重跑、無固定 sleep、使用 observable readiness/commit evidence

## Implementation evidence

- 新增 `smoke-memory-failure-matrix.mts`，對 tool、explicit/automatic learning、admin edit/delete/clear、Dream、import 逐一交叉 disk-full、read-only、busy timeout、forced close 與 transaction fault，共 40 組 fail-closed permutation。每組都驗證沒有 success response、沒有 `memory/changed`／publish、revision 不前進，重開資料庫後 integrity 與 baseline revision 不變。
- `beforeCommitWrite` test seam 位於真 SQLite `BEGIN IMMEDIATE` 與 `COMMIT` 之間，fault 後走 production rollback；`BEGIN IMMEDIATE` 也納入相同 typed `unavailable` error boundary，真實 `SQLITE_BUSY` 不再漏出 raw exception。
- busy timeout 在任何 integrity/schema preflight 前安裝，兩個獨立 Host fixture process 可安全重疊啟動。contention fixture 以 public memory protocol 驗證相同 operation identity 只產生一個 entry、不同寫入取得連續 revision、held transaction 造成 bounded busy failure、release 後可繼續寫入，最後 `integrity_check` 為 `ok`。
- crash fixture 經 tool、兩種 run learning、special profile、admin edit/delete/clear、Dream 與 import 全部收到 acknowledgement 後立即 `SIGKILL`。重啟後 acknowledged rows、更新值、刪除／clear absence、Dream 結果與 import 均正確，logical identity 無 duplicate，revision 與 crash 前 acknowledgement 相同。
- sanitizer matrix 覆蓋 Memory Pack、run learning、profile/document、import preview 與 legacy bridge；quota matrix覆蓋 special entry、import apply 與 legacy migration。Turn Record memory receipt 只保留固定 metadata 欄位，額外 text／credential 被捨棄。
- privacy assertions 檢查 revision/event/error payload、SQLite metadata audit、hard-delete database bytes，不含 credential、deleted 或 cleared content；deletion capability 保持 best-effort 限制，export warning 明示 plaintext 且 not encrypted。
- export 的 concurrent snapshot 仍由 Ticket 11 的同一 production smoke 覆蓋；Ticket 14 matrix 與既有 Ticket 06–13 smokes一起由 `smoke:pi-parity-qualification` 執行，沒有重新實作另一份 store。
- 協調只等待 `ready`、`transaction-held`、protocol response、acknowledgement 與 process exit；沒有固定 sleep。timeout 僅作 failure watchdog。
- `npm run build`、`npm run smoke:pi-parity-qualification` 與直接 `tsc -b` 通過。完整 `npm run smoke` 亦執行並通過本 matrix，之後停在非本票的既有 `smoke-pi-host-orchestration.mts:165` 斷言。

## Blocked by

- 06 — Memory Pack 工具完整遷移
- 07 — Task run learning 的結算生命週期
- 09 — Scoped clear、hard delete 與確認 UX
- 10 — Dream consolidation 的 Host transaction
- 11 — Canonical memory export
- 12 — Preview-first atomic memory import
- 13 — Host storage lifecycle、corruption 與 downgrade
