# 12 — Preview-first atomic memory import

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓使用者先預覽 versioned memory bundle 的 add/update/conflict/invalid 影響，再選擇 skip、overwrite 或 rename conflict mode，以單一 transaction 套用。匯入沿用同一 scope、validation、quota、sanitization 與 revision policy，不能成為繞過 authority 的旁門。

## Acceptance criteria

- [x] preview 完整解析支援版本並回報 add/update/conflict/invalid/quota counts，不在 preview 階段 mutation
- [x] unsupported version、malformed scope、invalid special entry、oversized content/tag/batch 與 sanitizer rejection 有可操作錯誤
- [x] skip/overwrite/rename 對 `(scope, logical key)` conflict 有 deterministic 結果，rename 不破壞 project isolation
- [x] apply 使用 admin/migration origin 並在單一 transaction 完成；中途任何 failure 整批 rollback
- [x] 同一 import operation retry 冪等，不重複 entries/revisions；成功後 projection 即時 refetch
- [x] import 不接受 bundle 內偽造 runtime authority、approval 或 instruction metadata
- [x] export→preview→apply→export round trip 對 scopes、profile/document、Unicode/tags 與 provenance 具可比較結果
- [x] UI smoke 覆蓋 preview、取消、三種 conflict mode、invalid/quota、rollback、retry 與 restart durability

## Blocked by

- 03 — Authority boundary 的 scope、policy 與 idempotency
- 04 — JSON → SQLite 原子遷移與 authority cutover
- 08 — Learning／Settings 即時 Host UI Projection
- 11 — Canonical memory export

## Resolution evidence

- 新增 capability-negotiated Host `memory/v1/import-preview` 與 `memory/v1/import-apply`。main IPC 明確挑選 input 欄位並自行提供 admin access，renderer 無法以 bundle 取得 runtime authority；runtime import 一律拒絕。
- 共用 planner 嚴格解析 `subagents.durable-memory` schema v1，限制 16 MiB／1,000 entries，驗證 header、scope、special key、tags、content、sanitizer 與 provenance allowlist。沿用 canonical draft 與 quota 規則；preview 回傳 counts、逐筆錯誤與目的地，不回傳 private body，也不寫 entries、revision 或 event。
- Skip 保留現有 entry，overwrite 更新同 scope/key，rename 依序使用 `~import-N` 並維持原 scope；profile/document special key 不允許 rename，preview 明示需改用 skip/overwrite。
- Apply 綁定 preview hash、mode 與 expected revision，於 SQLite `BEGIN IMMEDIATE` 內重算計畫、寫入全部 entries/provenance、單一 revision 與 metadata-only operation receipt；任何中途失敗整批 rollback。相同 operation retry 不重複寫入，Host 重啟亦保留 receipt；已刪除的 target 不會因 retry 復活。
- 實際 provenance 固定記錄 admin/migration import，bundle provenance 僅存為不授權的 `importedFrom`，驗證後複製保存，外部修改原始 bundle 不得改變已儲存來源。
- Learning 與 Settings 共用 `MemoryImportPanel`／`MemoryImportSession`，選檔先預覽，確認後才套用；支援三種模式、取消、錯誤阻擋、相同 operation 重試與成功後 projection refetch。取消讀檔不會讓稍後回覆復活預覽；bridge 缺失明確失敗，不回寫 legacy memory。
- 設定包的「只匯入設定」不套用 incoming legacy/canonical memory，並保留本機既有 legacy memory。記憶只能經獨立 preview/apply 流程恢復。
- `smoke-canonical-memory-import.mts` 直接使用 shipped Host protocol、SQLite/in-memory adapter 與 UI controller，涵蓋 preview 不變、三種 conflict mode、invalid/quota、authority forgery、stale preview、中途 rollback、source alias isolation、多 project/global special entries/Unicode/tags/provenance round trip，以及 commit 成功但回覆遺失後重啟 Host 再以同 operation retry。
- 驗證通過：`npm run build`、`npm run smoke:pi-parity-qualification`、`npm run smoke:learning-export`、獨立 import smoke、變更檔案 oxlint（僅既有 warnings）、`git diff --check`。Standards 與 Spec 平行 review 的 actionable findings 已修正並複查通過。
- 驗證限制：完整 `npm run smoke` 仍在 Ticket 11 已記錄的 `smoke-pi-host-orchestration.mts:165` legacy explicit-memory assertion 失敗。本票 UI smoke 是 shipped controller + real Host 證據；瀏覽器 localhost 點測先前被 URL 安全政策阻擋，未繞過該限制，未宣稱完成 browser pointer／pixel 驗證。已逐項重查 anti-slop 規則的 source 適用項目：沿用既有視覺語言、原生具 label 控制、文字預設可見、無新增 reveal/glow/hover 位移或裝飾卡片；實際像素與 pointer 驗證仍保留上述限制。
