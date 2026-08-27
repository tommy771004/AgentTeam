# 03 — Authority boundary 的 scope、policy 與 idempotency

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把 scope、run policy、identity、validation、quota、sanitization 與 retry idempotency 集中到 DurableMemoryStore authority boundary。任何 Host protocol 或 Extension Pack 呼叫都無法繞過這些規則；administrative、runtime 與 migration origin 使用明確不同的權限，而不是由呼叫端自行約定。

## Acceptance criteria

- [x] runtime read 只能看 global + current canonical project；get/search/list/delete/clear 對其他 project 全部 fail closed
- [x] project identity 在存取前一致處理 symlink、分隔符、尾斜線與平台可適用的大小寫規則
- [x] temporary 禁止 runtime read/write；memory disabled 禁止 recall；write disabled 禁止 explicit/tool/automatic runtime writes
- [x] runtime、admin、migration、consolidation origin 的允許操作由單一 authority 判定，普通 tool 無法取得 admin enumeration/clear 能力
- [x] synthetic identity 與 `(scope, logical key)` uniqueness 允許不同 project 使用相同 key，且不互相覆寫
- [x] deterministic operation identity 讓 set/append retry 回傳既有結果，不建立 duplicate entry 或重複 revision
- [x] text/key/tag/timestamp/page/import-batch 驗證與 per-project/global quota 對兩個 adapter 和所有 origins 一致
- [x] protected data／credential sanitizer 在 commit 前執行；拒絕時不 commit、不發布 revision、不回 success
- [x] protocol policy matrix 覆蓋 global/current/other project × enabled/disabled × temporary × runtime/admin/migration，且逐一測 get/search/set/append/delete/clear

## Blocked by

02 — SQLite 記憶的 Host protocol vertical slice

## Comments

- `durableMemoryStore.ts` 現為單一 authority policy owner：所有 adapter 操作先做 origin/action、runtime flags、canonical scope、validation、quota 與 protected credential rejection；project identity 使用 realpath、separator/trailing-slash normalization，並依平台套用大小寫規則。
- runtime set/append operation identity 由 runId + callId + mode + scope + logical key 的 JSON tuple 決定（不以可碰撞的分隔符串接）；in-memory 與 SQLite 都會讓相同 payload retry 回傳現存結果，不推進 revision。不同 payload 重用同 identity 會 fail closed。若原 entry 後來更新，延遲 retry 只讀現存版本、不覆寫；原 identity 已刪除則回 `not_found`，不重建記憶、不回傳已刪正文。
- SQLite schema migration v2 只保存 operation hash、entry identity 與 result revision，不在 operation journal 複製 memory text；unique operation index 與 Host write queue 共同處理 concurrent retry。
- `memory-store-v1` 增加 append/clear typed operations；post-commit event 以 revision claim 去重，兩個 concurrent identical append 只發布一次事件。production supervisor 仍未預設協商此 capability，legacy JSON authority 尚未 cutover。
- Host v1 envelope 的 access 是受信任 parent／Host caller 的輸入，不是模型工具參數；本票驗證 origin/action policy，#05／#06 將各 production caller 綁到 frozen admission context，#08 才接管理 UI。不得把此票解讀成 legacy Memory Pack 已完成切換。
- validation 拒絕錯誤 kind/scope、非字串 tags/text、非 boolean flags、無效 import mode 與非 canonical cursor；特殊 profile/document 的內建 tags 也計入 quota。Host 協定將 store `invalid_input` 映射成既有 `invalid_request`，其他 typed policy errors 保留。
- consolidation 必須有 bounded 非空來源，先 canonicalize 再去重；合併結果使用 canonical key，不能以 merged 額外欄位覆蓋已授權 scope，若取代同 key 來源則建立新 identity。credential rejection 辨識明文與 JSON 欄位，正常 password/API key 管理敘述不誤拒；project canonicalization 也涵蓋 symlink 下尚未建立的子路徑與 symlink/..，非 ENOENT 的路徑錯誤不靜默略過。
- `smoke-durable-memory-authority.mts` 對 in-memory／SQLite 跑同一套 scope、policy、idempotency、validation、quota、sanitizer、realpath contract；`smoke-pi-host-memory-policy-matrix.mts` 由 public protocol 覆蓋 get/list/recall/set/append/delete/clear 的 672 組 origin/read/write/temporary/scope 矩陣，拒絕時驗證 revision 與 event 不變。真 Host restart smoke 另驗證 append retry 不重複寫入／發事件，刪除後舊 retry 不復活。
- 驗證：相關 oxlint、Node typecheck、complexity gate、`npm run build`、`npm run smoke:pi-parity-qualification` 與完整 `npm run smoke` 全綠（含 Electron Pi Host restart E2E）。
