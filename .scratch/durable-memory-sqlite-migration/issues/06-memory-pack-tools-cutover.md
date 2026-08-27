# 06 — Memory Pack 工具完整遷移

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把 builtin Pi 的 memory get/search/set/append 全部接到 scoped DurableMemoryStore，使工具成功具有 commit durability，失敗具有 fail-closed policy，retry 具有 idempotency。Memory Pack 只拿受限 service，不得持有 memory array 或 admin interface。

## Acceptance criteria

- [ ] get/search/set/append 都攜帶同一 frozen access context，沒有 undefined project 或 id-only scope bypass
- [ ] memory disabled、write disabled、temporary、other-project 與 invalid/quota inputs 回 typed tool failure，不 commit
- [ ] set 使用 scope-aware logical key；不同 project 同 key 共存，同 project upsert revision 單調
- [ ] append 使用 run/tool-call operation identity；同一呼叫 retry 不新增 duplicate content 或 revision
- [ ] tool success 僅在 SQLite commit 後產生；disk/lock/policy failure 不發布 `memory-written` 或 `memory/changed` success
- [ ] Memory Pack bridge 不暴露 list-all、clear-all、raw database 或 mutable collection
- [ ] tool response、Host context activity 與 Turn Record 對同一 write identity 可對帳，但不洩漏不必要 private content
- [ ] 真 Pi tool-call smoke 覆蓋 success、retry、same-key cross-project、write-disabled、temporary 與 restart durability

## Blocked by

- 04 — JSON → SQLite 原子遷移與 authority cutover
- 05 — Builtin Pi scoped recall 與 Turn Record provenance
