# 06 — Memory Pack 工具完整遷移

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把 builtin Pi 的 memory get/search/set/append 全部接到 scoped DurableMemoryStore，使工具成功具有 commit durability，失敗具有 fail-closed policy，retry 具有 idempotency。Memory Pack 只拿受限 service，不得持有 memory array 或 admin interface。

## Acceptance criteria

- [x] get/search/set/append 都攜帶同一 frozen access context，沒有 undefined project 或 id-only scope bypass
- [x] memory disabled、write disabled、temporary、other-project 與 invalid/quota inputs 回 typed tool failure，不 commit
- [x] set 使用 scope-aware logical key；不同 project 同 key 共存，同 project upsert revision 單調
- [x] append 使用 run/tool-call operation identity；同一呼叫 retry 不新增 duplicate content 或 revision
- [x] tool success 僅在 SQLite commit 後產生；disk/lock/policy failure 不發布 `memory-written` 或 `memory/changed` success
- [x] Memory Pack bridge 不暴露 list-all、clear-all、raw database 或 mutable collection
- [x] tool response、Host context activity 與 Turn Record 對同一 write identity 可對帳，但不洩漏不必要 private content
- [x] 真 Pi tool-call smoke 覆蓋 success、retry、same-key cross-project、write-disabled、temporary 與 restart durability

## Blocked by

- 04 — JSON → SQLite 原子遷移與 authority cutover
- 05 — Builtin Pi scoped recall 與 Turn Record provenance

## 接續註記（#04）

#04 已把 pack bridge 改成 scoped async store service，讀取 session/run binding 的 frozen flags，await commit 後才成功／發布 metadata-only revision。append key 使用 run/call identity，同 binding retry 保留 timestamp；無有效 binding 拒絕。仍需補真 Pi model tool-call／跨 restart payload preservation、typed failure metadata 與 Turn Record write identity 對帳。本票尚未 resolved，不能把直接 service fixture 當作完整真模型工具驗收。

## Answer

Memory Pack 的 bridge 已收斂為 `search/get/set/append` 四個受限方法；寫入端只接受 frozen run binding 衍生的 canonical project、run/session/call identity，不再接收 caller 提供的 project，也不暴露 list-all、clear、database 或 mutable collection。`set` 使用 project-scoped logical key；`append` 進入 `DurableMemoryStore.append` 並以 run/tool-call identity 去重。兩者都在 SQLite commit 後才回傳 metadata-only `memoryWrite` receipt。

預期的 policy／validation／quota／store 錯誤現在都以 `{ok:false, error, code}` 留在工具 content，不 throw 結束 Pi turn；structured failure 在 Host terminal lifecycle 會記為 `failed`。成功 receipt 以同一組 operation、logicalKey、revision、run/session/call identity 串起工具回應、`host/context: memory-written` 與 Turn Record `tool-result.memoryWrite`；`memory/changed` 與 record/activity 都不保存 private memory text，retry 也不重複發布。

新增真 Pi loopback-model smoke，實際依序呼叫 set、append retry、get、search，並覆蓋 same-key cross-project、write-disabled、temporary 與 Host restart 後 payload durability。直接 store/pack fixture另覆蓋 disabled read、other-project、invalid、quota、detached binding、closed store 與 revision/event 不前進。

驗證：`npm run build`、`npm run smoke:pi-parity-qualification`、`npm run smoke:pi-host`、focused direct/real-Pi smokes、`git diff --check` 全綠；`npx oxlint src electron` 無新增 error，輸出的 warnings 皆為既有非本票檔案。完整主 smoke 首次跑到既有 Pack settlement 時揭露語意擴張，修正為只讓 `memory_*` opt in typed-content failure 後，相關 Pack smoke 與完整 Pi Host gate 均已重跑通過。

## Comments

- `memoryWrite` 是 commit receipt，不是第二份記憶資料：只含 bounded identity/revision metadata，正文仍只存在 DurableMemoryStore 與當次模型工具結果。
- append 仍建立每個 tool call 專屬 logical key；其真正 mutation owner 已從 generic upsert 改為 store `append`，同 call retry 回同一 entry/revision。
