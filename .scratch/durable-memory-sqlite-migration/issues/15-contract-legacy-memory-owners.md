# 15 — Contract 舊 JSON 與 renderer memory owners

Status: 已解決
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

完成 expand–contract 的 contract 階段：在所有 workflows 已遷移且 failure matrix 通過後，移除舊 JSON live-memory 欄位、renderer whole-bundle sync、renderer Dream mutations、legacy export source 與其他 production memory owners。plain-browser degrade 只有在仍有實際 caller 時保留，且不得反向覆寫 Host。

## Acceptance criteria

- [x] production Host snapshot 不再保存或重寫 live memories；backup/migration reader 與 live authority 的角色清楚分離
- [x] renderer 不再 whole-bundle sync 新增 entries，也不以 localStorage/Zustand collection 覆寫 Host revision
- [x] Dream、Settings profile/document、Learning CRUD、automatic learning、Memory Pack、export/import 全部只有 DurableMemoryStore mutation path
- [x] legacy memory source 的 production inbound callers 為 0；若 plain-browser degrade 仍保留，其型別/guard 明確禁止 Electron production 使用
- [x] protocol/supervisor/main/preload/shared types 的舊 memory shape 同步移除或 version-gated，沒有半新半舊 call site
- [x] source-text drift guards repoint 到新 authority 並禁止新增第二 owner；不得以放寬 allowlist 讓 smoke 通過
- [x] obsolete tests 改為驗 shipped modules，不在 smoke 內重做已移除的舊邏輯
- [x] graph inbound trace、literal search 與 coverage check 對每個刪除候選留下證據；build/lint/full smoke 維持綠

## Implementation evidence

- Pi Host Protocol v5 移除 `memory/list|add|delete|clear|recall` 與 `result.memories`；Supervisor、Main IPC、preload bridge 同步移除，retired method 由真 Host 回 `unknown_method`，不提供假相容 response。
- `PiMemoryExtension` 與其 mutable array owner 已刪除。`piMemory.ts` 只保留 recall framing／legacy migration 所需的值型別與 validator，不提供 collection mutation。
- production `PiHostSnapshot` 不再有 `memories`；schema 4 snapshot 不寫該欄位。schema 1/2 raw rows 只在 `openPiHostStorage` migration staging 讀取，schema 3 僅作已安裝舊版 reader 相容，SQLite 仍是唯一 live authority。
- `check-pi-contract.mts` 新增單一-owner drift guard，固定禁止舊檔、舊 IPC channels、舊 Host responses 與 production snapshot memory shape 回流。
- obsolete `smoke-pi-host-memory.mts` 已移除；context smoke 不再重建舊 store。migration、projection、cutover consumer 與 orchestration smokes 均改驗 shipped `memory/v1`、finalization settlement 與 contracted snapshot。
- literal inbound audit 對 production 舊 channels 為 0；本環境沒有可呼叫的 codebase-memory graph MCP，因此 graph trace 以 `rg` caller inventory 加 protocol/source drift guard 取代並留在 gate。
- 驗證：`npx tsc -b --pretty false`、`npm run check:pi-contract`、`npm run smoke:pi-parity-qualification` 全綠；`smoke-pi-host-orchestration.mts` 單獨通過。完整 build/lint/smoke 由 Ticket 16 最終 gate 收口。

## Blocked by

- 05 — Builtin Pi scoped recall 與 Turn Record provenance
- 06 — Memory Pack 工具完整遷移
- 07 — Task run learning 的結算生命週期
- 08 — Learning／Settings 即時 Host UI Projection
- 09 — Scoped clear、hard delete 與確認 UX
- 10 — Dream consolidation 的 Host transaction
- 11 — Canonical memory export
- 12 — Preview-first atomic memory import
- 13 — Host storage lifecycle、corruption 與 downgrade
- 14 — Durability、並行與 privacy failure matrix
