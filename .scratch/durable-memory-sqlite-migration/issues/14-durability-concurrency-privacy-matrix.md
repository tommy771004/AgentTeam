# 14 — Durability、並行與 privacy failure matrix

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

用跨 workflow failure matrix 驗證所有已遷移的寫入來源具有相同 durability、contention 與 privacy 語意。這張票修補從 tool、automatic learning、admin、clear、Dream、export/import 到 shutdown 的整體缺口，確保沒有某個旁路仍先回成功、漏 sanitizer 或在 concurrency 下破壞資料。

## Acceptance criteria

- [ ] tool、explicit/automatic learning、admin edit/delete/clear、Dream 與 import 都符合 commit-before-success；export 使用一致 snapshot
- [ ] immediate process kill after acknowledgement 再啟動時，每種 acknowledged mutation 都存在且沒有 duplicate
- [ ] disk-full、read-only、busy timeout、forced close 與 transaction fault 對所有 write origins 都不回 success、不發布 success revision
- [ ] 兩個 Host process 競爭同一 DB 時 uniqueness、operation idempotency、busy handling 與 revision 保持有效，DB integrity 不受損
- [ ] sanitizer/validation/quota 無法由 import、consolidation、special-entry Settings 或 legacy bridge 繞過
- [ ] revision/activity/Turn Record/audit/error payload 不包含不必要 memory text、credential 或 deleted content
- [ ] hard delete 後依 09 contract 執行 checkpoint/平台能力，測試與產品文案不把 plaintext SQLite 說成 encrypted
- [ ] failure matrix 掛入主 smoke chain並可重跑、無固定 sleep、使用 observable readiness/commit evidence

## Blocked by

- 06 — Memory Pack 工具完整遷移
- 07 — Task run learning 的結算生命週期
- 09 — Scoped clear、hard delete 與確認 UX
- 10 — Dream consolidation 的 Host transaction
- 11 — Canonical memory export
- 12 — Preview-first atomic memory import
- 13 — Host storage lifecycle、corruption 與 downgrade
