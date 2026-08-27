# 03 — Authority boundary 的 scope、policy 與 idempotency

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把 scope、run policy、identity、validation、quota、sanitization 與 retry idempotency 集中到 DurableMemoryStore authority boundary。任何 Host protocol 或 Extension Pack 呼叫都無法繞過這些規則；administrative、runtime 與 migration origin 使用明確不同的權限，而不是由呼叫端自行約定。

## Acceptance criteria

- [ ] runtime read 只能看 global + current canonical project；get/search/list/delete/clear 對其他 project 全部 fail closed
- [ ] project identity 在存取前一致處理 symlink、分隔符、尾斜線與平台可適用的大小寫規則
- [ ] temporary 禁止 runtime read/write；memory disabled 禁止 recall；write disabled 禁止 explicit/tool/automatic runtime writes
- [ ] runtime、admin、migration、consolidation origin 的允許操作由單一 authority 判定，普通 tool 無法取得 admin enumeration/clear 能力
- [ ] synthetic identity 與 `(scope, logical key)` uniqueness 允許不同 project 使用相同 key，且不互相覆寫
- [ ] deterministic operation identity 讓 set/append retry 回傳既有結果，不建立 duplicate entry 或重複 revision
- [ ] text/key/tag/timestamp/page/import-batch 驗證與 per-project/global quota 對兩個 adapter 和所有 origins 一致
- [ ] protected data／credential sanitizer 在 commit 前執行；拒絕時不 commit、不發布 revision、不回 success
- [ ] protocol policy matrix 覆蓋 global/current/other project × enabled/disabled × temporary × runtime/admin/migration，且逐一測 get/search/set/append/delete/clear

## Blocked by

02 — SQLite 記憶的 Host protocol vertical slice
