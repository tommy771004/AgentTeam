# 10 — Dream consolidation 的 Host transaction

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把 Dream consolidation 從 renderer-owned MemoryStore 搬進 Host Memory Extension。候選讀取、dedupe/merge 決策、merged write、source supersede/delete 與 revision publication 必須在同一個可重試 transaction 完成，Learning projection 只觀察結果。

## Acceptance criteria

- [x] consolidation 只經 DurableMemoryStore 讀寫，不把 renderer memory collection 當 input 或 authority
- [x] scope 不混合：project consolidation 不讀寫其他 project；global special entries 不被普通 consolidation 合併
- [x] source selection、merged entry、supersede/delete 與 operation identity 在同一 transaction settle
- [x] 任一 fault point 失敗時 merged entry 與 source status 都保持 transaction 前狀態，不發布 success revision
- [x] retry 使用同一 operation identity，不重複建立 merge result 或刪除額外 entries
- [x] success 發布單調 revision，Learning projection 自動 refetch，無 renderer two-way sync
- [x] retention/superseded policy 有上限且不把 decay 自動解讀成 deletion
- [x] deterministic consolidation fixture 與真 Host smoke 覆蓋 success、no-op、cross-scope、fault injection、retry 與 UI observation

## Blocked by

- 04 — JSON → SQLite 原子遷移與 authority cutover
- 08 — Learning／Settings 即時 Host UI Projection

## Resolution evidence

- Electron production 的 idle Dream 不再讀 renderer `memoryStore`；它只呼叫窄化的 `memoryProjection.consolidateDream` bridge。plain-browser 才保留既有 Hermes fallback。
- `DurableMemoryStore.consolidateDream` 在 scope 內選取 `auto`／`flush` 普通 memory；project 不跨界，profile/document 與 `dream` 結果不進候選。central consolidation authority 對跨 project fail closed。
- SQLite 在同一 `BEGIN IMMEDIATE` transaction 內完成 candidate read、deterministic dedupe、最多 64 筆 retention window、最舊 12 筆摘要合併、source delete、operation audit 與 revision；不以 decay/staleness 直接刪除。
- operation identity 綁定 scope、policy 與四小時 bucket。成功後 retry 只回放 committed revision；identity 換 scope/policy 會拒絕，且不重複建立摘要或刪除來源。
- `after-source-read`、`after-source-delete`、`after-merged-write` 三個 fault point 在 in-memory 與真 SQLite fixture 都驗證 entry set/revision 回到 transaction 前狀態；同 identity 隨後可安全 retry。
- 成功只發布一個 `memory/changed(consolidate-dream)` post-commit event；App 沿用 Ticket 08 monotonic invalidation/refetch，renderer 不做 whole-list persist/sync。
- 驗證：`npm run build`、`npm run smoke:pi-parity-qualification`、`smoke-memory-dream-consolidation.mts`、`smoke-caps.mjs`、targeted `oxlint`、`git diff --check`。
