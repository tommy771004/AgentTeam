# 04 — JSON → SQLite 原子遷移與 authority cutover

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

在 Host startup 將舊 JSON memories 原子遷移至 SQLite，並把 production Memory Extension 切換為 DurableMemoryStore 唯一 authority。遷移必須可重啟、可診斷且不 dual-write：成功前舊 JSON 仍是來源，成功後只認 SQLite，backup 只是 recovery evidence。

## Acceptance criteria

- [ ] startup 先驗證舊 snapshot、建立可識別 backup，再於單一 SQLite transaction 匯入有效 entries 與 migration marker
- [ ] v1/v2、空資料、duplicate id、跨 project 同 key、profile/document、invalid date/tag/oversized row fixtures 都有確定結果
- [ ] invalid rows 被 quarantine/report，不讓整批靜默消失，也不把 wholly corrupt JSON 當空資料覆寫
- [ ] crash-before-commit 會從 JSON 安全重試；crash-after-commit-before-state-advance 由 marker 識別且不重複匯入
- [ ] migration commit 後 Host state schema 宣告 SQLite authority，production list/recall/mutation 只讀寫 DurableMemoryStore
- [ ] JSON memories 不再被 live update，且沒有任何 dual-write window
- [ ] 不相容舊版本 downgrade fail closed 並提供 actionable message，不得恢復 JSON write
- [ ] 真 Host migration/restart smoke 證明 cutover 前後資料、scope、revision 與 special entries 一致

## Blocked by

03 — Authority boundary 的 scope、policy 與 idempotency
