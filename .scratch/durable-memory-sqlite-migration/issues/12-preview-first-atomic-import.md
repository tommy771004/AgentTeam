# 12 — Preview-first atomic memory import

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓使用者先預覽 versioned memory bundle 的 add/update/conflict/invalid 影響，再選擇 skip、overwrite 或 rename conflict mode，以單一 transaction 套用。匯入沿用同一 scope、validation、quota、sanitization 與 revision policy，不能成為繞過 authority 的旁門。

## Acceptance criteria

- [ ] preview 完整解析支援版本並回報 add/update/conflict/invalid/quota counts，不在 preview 階段 mutation
- [ ] unsupported version、malformed scope、invalid special entry、oversized content/tag/batch 與 sanitizer rejection 有可操作錯誤
- [ ] skip/overwrite/rename 對 `(scope, logical key)` conflict 有 deterministic 結果，rename 不破壞 project isolation
- [ ] apply 使用 admin/migration origin 並在單一 transaction 完成；中途任何 failure 整批 rollback
- [ ] 同一 import operation retry 冪等，不重複 entries/revisions；成功後 projection 即時 refetch
- [ ] import 不接受 bundle 內偽造 runtime authority、approval 或 instruction metadata
- [ ] export→preview→apply→export round trip 對 scopes、profile/document、Unicode/tags 與 provenance 具可比較結果
- [ ] UI smoke 覆蓋 preview、取消、三種 conflict mode、invalid/quota、rollback、retry 與 restart durability

## Blocked by

- 03 — Authority boundary 的 scope、policy 與 idempotency
- 04 — JSON → SQLite 原子遷移與 authority cutover
- 08 — Learning／Settings 即時 Host UI Projection
- 11 — Canonical memory export
