# 02 — SQLite 記憶的 Host protocol vertical slice

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓隔離測試 Host 可以透過 versioned Pi Host memory protocol 對 SQLite 做 scoped add/get/list/recall/delete，並在 process restart 後讀回相同資料。這條 tracer bullet 同時穿過 production SQLite adapter、Memory Extension、protocol、supervisor relay、revision event 與真 Host smoke，但尚不切換既有 JSON authority。

## Acceptance criteria

- [ ] SQLite adapter 與 in-memory adapter 通過 01 的同一套 contract fixtures
- [ ] SQLite schema 具 synthetic identity、scope + logical key uniqueness、normalized tags、provenance、revision/content hash、operation 與 migration metadata
- [ ] SQLite 啟用 WAL、busy timeout、transaction 與 Host write serialization；所有 schema migration 單調且有版本記錄
- [ ] 真 Host protocol 可完成 scoped add/get/list/recall/delete，response 與 shared protocol types 一致
- [ ] mutation 只有在 transaction commit 後才回 success，並發布不含 private content 的 monotonic `memory/changed` revision event
- [ ] Host restart 後已 acknowledge 的資料與 revision 仍存在；未 commit 的資料不可見
- [ ] protocol negotiation 對不支援新 memory shape 的 client fail closed，不默默猜測舊 response
- [ ] smoke 使用隔離 temporary state/database、只驗 protocol observable behavior，不以私有 SQL layout 當正常行為證據

## Blocked by

01 — DurableMemoryStore 契約與 retrieval parity
