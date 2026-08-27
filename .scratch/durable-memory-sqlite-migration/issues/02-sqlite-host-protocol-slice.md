# 02 — SQLite 記憶的 Host protocol vertical slice

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓隔離測試 Host 可以透過 versioned Pi Host memory protocol 對 SQLite 做 scoped add/get/list/recall/delete，並在 process restart 後讀回相同資料。這條 tracer bullet 同時穿過 production SQLite adapter、Memory Extension、protocol、supervisor relay、revision event 與真 Host smoke，但尚不切換既有 JSON authority。

## Acceptance criteria

- [x] SQLite adapter 與 in-memory adapter 通過 01 的同一套 contract fixtures
- [x] SQLite schema 具 synthetic identity、scope + logical key uniqueness、normalized tags、provenance、revision/content hash、operation 與 migration metadata
- [x] SQLite 啟用 WAL、busy timeout、transaction 與 Host write serialization；所有 schema migration 單調且有版本記錄
- [x] 真 Host protocol 可完成 scoped add/get/list/recall/delete，response 與 shared protocol types 一致
- [x] mutation 只有在 transaction commit 後才回 success，並發布不含 private content 的 monotonic `memory/changed` revision event
- [x] Host restart 後已 acknowledge 的資料與 revision 仍存在；未 commit 的資料不可見
- [x] protocol negotiation 對不支援新 memory shape 的 client fail closed，不默默猜測舊 response
- [x] smoke 使用隔離 temporary state/database、只驗 protocol observable behavior，不以私有 SQL layout 當正常行為證據

## Blocked by

01 — DurableMemoryStore 契約與 retrieval parity

## Comments

- `sqliteDurableMemoryStore.ts` 實作 Host-only SQLite adapter；in-memory／SQLite 共用 `runDurableMemoryContract`，並以 rollback fixture 驗證失敗 transaction 不推進 revision。
- schema 記錄 synthetic identity、scope + logical key unique key、normalized tags、provenance、content hash、operation、revision 與 monotonic migration version；連線啟用 WAL、5 秒 busy timeout、foreign keys，所有 mutation 經單一 `BEGIN IMMEDIATE` write queue，commit 後才 resolve。
- `memory-store-v1` 在 Pi Host protocol v4 上採顯式 capability negotiation；未協商的 caller 收到 `protocol_mismatch`。production supervisor 預設未要求新 capability，因此 legacy JSON memory authority 尚未 cutover。
- `smoke-pi-host-durable-memory.mts` 以隔離 temp state/database 驗真 Host CRUD/recall、無 private content 的 revision event、restart durability、legacy snapshot 未被寫入，以及 supervisor typed relay；`smoke-sqlite-durable-memory-store.mts` 另驗共用 contract、restart 與 serialized concurrent writes。
- 驗證：`npm run build`、`npm run smoke:pi-parity-qualification`、`npm run smoke:pi-host`、完整 `npm run smoke` 全綠；`npx tsc -p tsconfig.node.json --noEmit`、相關 oxlint 與 complexity gate 全綠。
