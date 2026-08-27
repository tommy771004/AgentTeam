# 15 — Contract 舊 JSON 與 renderer memory owners

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

完成 expand–contract 的 contract 階段：在所有 workflows 已遷移且 failure matrix 通過後，移除舊 JSON live-memory 欄位、renderer whole-bundle sync、renderer Dream mutations、legacy export source 與其他 production memory owners。plain-browser degrade 只有在仍有實際 caller 時保留，且不得反向覆寫 Host。

## Acceptance criteria

- [ ] production Host snapshot 不再保存或重寫 live memories；backup/migration reader 與 live authority 的角色清楚分離
- [ ] renderer 不再 whole-bundle sync 新增 entries，也不以 localStorage/Zustand collection 覆寫 Host revision
- [ ] Dream、Settings profile/document、Learning CRUD、automatic learning、Memory Pack、export/import 全部只有 DurableMemoryStore mutation path
- [ ] legacy memory source 的 production inbound callers 為 0；若 plain-browser degrade 仍保留，其型別/guard 明確禁止 Electron production 使用
- [ ] protocol/supervisor/main/preload/shared types 的舊 memory shape 同步移除或 version-gated，沒有半新半舊 call site
- [ ] source-text drift guards repoint 到新 authority 並禁止新增第二 owner；不得以放寬 allowlist 讓 smoke 通過
- [ ] obsolete tests 改為驗 shipped modules，不在 smoke 內重做已移除的舊邏輯
- [ ] graph inbound trace、literal search 與 coverage check 對每個刪除候選留下證據；build/lint/full smoke 維持綠

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
