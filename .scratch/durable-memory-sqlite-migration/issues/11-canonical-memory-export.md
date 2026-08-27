# 11 — Canonical memory export

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓 Settings 與 Learning 的記憶匯出直接由 Host canonical store 產生 versioned bundle。匯出需包含可恢復的 scope、special entries、tags 與必要 provenance，同時維持資料邊界、大小上限、路徑安全與 plaintext privacy 提醒。

## Acceptance criteria

- [x] export 經 Host admin interface 讀 canonical SQLite snapshot，不讀 legacy renderer/local memory source
- [x] bundle 有明確 schema/version、generated revision、project/global scope、profile/document、tags 與必要 provenance
- [x] export 在一致 read snapshot 上產生；同時 mutation 不造成半新半舊 bundle
- [x] deleted/superseded content 依 retention contract 處理，metadata-only audit 不被還原成內容
- [x] export size/page limits、safe destination 與 restrictive file permissions 在支援平台生效
- [x] UI 明確提示匯出檔為 plaintext user data，不宣稱加密
- [x] bridge/Host failure 顯示錯誤且不產生看似成功的空 bundle；plain browser 安全降級
- [x] round-trip fixture 的 export 半段覆蓋多 project、global special entries、Unicode/tags、空 store 與 concurrent revision

## Blocked by

- 04 — JSON → SQLite 原子遷移與 authority cutover
- 08 — Learning／Settings 即時 Host UI Projection

## Resolution evidence

- Pi Host 新增 capability-negotiated `memory/v1/export` admin operation；Supervisor、main IPC 與 preload 只轉送 Host `DurableMemoryStore.exportBundle`，Settings/Learning 不再從 renderer `MemoryBundle` 或 legacy Hermes memory 產生記憶備份。
- bundle 使用 `subagents.durable-memory` schema v1，帶一致 snapshot revision、generatedAt、plaintext privacy warning、完整 scope/kind/tags/content 與目前 entry 的 bounded provenance（origin/operation/run/session/call）。deleted/superseded row 與 metadata-only operation audit 不會成為 entries。
- SQLite export 在等待已接受 writes 後，以 `BEGIN DEFERRED` 固定 read snapshot，同一 transaction 讀 entries、tags、provenance 與 revision；跨 process mutation 只能完整落在 snapshot 前或後。
- store 限制最多 1,000 entries / 16 MiB，超限 typed fail；Learning 的 project-relative writer 延續 traversal、absolute 與 symlink confinement，Settings 則由 Electron save dialog 取得明確 JSON 目的地。兩條 writer 都有 16 MiB 上限，並在支援平台強制 `0600` mode。
- Learning 只把 Host bundle 寫為 `.subagents/memory/durable-memory-v1.json`；plain browser 沒有 Host bridge 時明確拒絕 legacy/空匯出。Settings bundle v3 將 canonical memory 獨立納入，缺 bridge 或 Host rejection 都直接顯示錯誤，且不產生不完整或假成功檔。
- UI 的確認、說明與完成訊息都明示 memory 是未加密 plaintext user data；設定 secrets 仍維持既有 pattern redaction。
- `smoke-canonical-memory-export.mts` 覆蓋 real SQLite + public Pi Host protocol 的多 project 同 logical key、global profile/document、Unicode/tags、operation provenance、deleted content、空 store、export entry bound，並用第二 SQLite connection 與 snapshot barrier 強迫 mutation 在 read transaction 存續時 commit；`smoke-learning-export.mts` 覆蓋兩條 writer 的 safe path、oversize、`0600` 與 canonical bridge wiring。
- 驗證：`npm run build`、`npm run smoke:pi-parity-qualification`、`npm run smoke:learning-export`。
- 驗證限制：完整 `npm run smoke` 在 `smoke-pi-host-orchestration.mts:165` 的 legacy explicit-memory assertion 失敗，單獨重跑仍可重現；本票的 canonical memory qualification 全數通過。瀏覽器 URL 安全政策阻擋 localhost 點測，UI 目前只有 build、source wiring 與 writer smoke 證據，未宣稱完成 pointer 驗證。
