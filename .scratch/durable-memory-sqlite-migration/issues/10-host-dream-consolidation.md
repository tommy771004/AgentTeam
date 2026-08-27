# 10 — Dream consolidation 的 Host transaction

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把 Dream consolidation 從 renderer-owned MemoryStore 搬進 Host Memory Extension。候選讀取、dedupe/merge 決策、merged write、source supersede/delete 與 revision publication 必須在同一個可重試 transaction 完成，Learning projection 只觀察結果。

## Acceptance criteria

- [ ] consolidation 只經 DurableMemoryStore 讀寫，不把 renderer memory collection 當 input 或 authority
- [ ] scope 不混合：project consolidation 不讀寫其他 project；global special entries 不被普通 consolidation 合併
- [ ] source selection、merged entry、supersede/delete 與 operation identity 在同一 transaction settle
- [ ] 任一 fault point 失敗時 merged entry 與 source status 都保持 transaction 前狀態，不發布 success revision
- [ ] retry 使用同一 operation identity，不重複建立 merge result 或刪除額外 entries
- [ ] success 發布單調 revision，Learning projection 自動 refetch，無 renderer two-way sync
- [ ] retention/superseded policy 有上限且不把 decay 自動解讀成 deletion
- [ ] deterministic consolidation fixture 與真 Host smoke 覆蓋 success、no-op、cross-scope、fault injection、retry 與 UI observation

## Blocked by

- 04 — JSON → SQLite 原子遷移與 authority cutover
- 08 — Learning／Settings 即時 Host UI Projection
