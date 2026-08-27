# 01 — DurableMemoryStore 契約與 retrieval parity

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

先建立一個 async、Host-owned 的 `DurableMemoryStore` 契約與 in-memory adapter，並用固定 corpus 凍結現行 recall 行為。這是 expand 階段的 prefactor：production authority 暫不切換，但後續 SQLite、Memory Pack、Learning UI、Dream 與匯出入只能依這個契約遷移，不能各自發明資料模型。

## Acceptance criteria

- [x] 契約涵蓋 scoped upsert/get/recall/list/delete/clear、revision、health、consolidate、export/import、close 與 typed failures，所有 I/O 都是 async
- [x] access context 明確表達 canonical project、global/project scope、run/session/call identity、read/write setting、temporary 與 origin
- [x] in-memory adapter 完成契約並可獨立跑 deterministic contract fixtures，不依賴 renderer store、Electron 或 SQLite
- [x] 固定 corpus 凍結 global + current-project 合併、logical key、tags、always-recall、recency、limit 與既有 decay metadata 的可觀察結果
- [x] parity corpus 覆蓋 Traditional Chinese、混合中英文、Unicode normalization、大小寫與相同 logical key 位於不同 project
- [x] profile 與 memory document 被建模為 global always-recall 特殊種類，不退化成普通 project key
- [x] 契約註明 renderer 是 UI Projection、Memory Extension 是唯一 authority，adapter 不向消費端暴露 SQLite handle 或可變陣列
- [x] 新契約 smoke 接入主 smoke chain；production 仍走現行路徑且既有 memory smokes 維持綠

## Blocked by

無（expand prefactor，可立即開始）

## Comments

- 2026-08-27：新增 `electron/durableMemoryStore.ts` 的 async 契約與獨立 in-memory adapter，凍結 scoped recall、特殊 global 記憶、ranking／decay、生命週期與 export/import 行為；production authority 尚未切換。
- `scripts/smoke-durable-memory-store.mts` 已由 `smoke:pi-parity-qualification` 接入主 `npm run smoke` chain；既有 `smoke:pi-memory`、`smoke:pi-host-memory` 維持綠。
- 驗證：`npm run build`、`npx oxlint electron/durableMemoryStore.ts scripts/smoke-durable-memory-store.mts`、完整 `npm run smoke` 全綠。Code review：Standards 0 findings、Spec 0 findings。
