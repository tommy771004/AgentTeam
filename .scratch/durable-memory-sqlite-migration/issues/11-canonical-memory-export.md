# 11 — Canonical memory export

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓 Settings 與 Learning 的記憶匯出直接由 Host canonical store 產生 versioned bundle。匯出需包含可恢復的 scope、special entries、tags 與必要 provenance，同時維持資料邊界、大小上限、路徑安全與 plaintext privacy 提醒。

## Acceptance criteria

- [ ] export 經 Host admin interface 讀 canonical SQLite snapshot，不讀 legacy renderer/local memory source
- [ ] bundle 有明確 schema/version、generated revision、project/global scope、profile/document、tags 與必要 provenance
- [ ] export 在一致 read snapshot 上產生；同時 mutation 不造成半新半舊 bundle
- [ ] deleted/superseded content 依 retention contract 處理，metadata-only audit 不被還原成內容
- [ ] export size/page limits、safe destination 與 restrictive file permissions 在支援平台生效
- [ ] UI 明確提示匯出檔為 plaintext user data，不宣稱加密
- [ ] bridge/Host failure 顯示錯誤且不產生看似成功的空 bundle；plain browser 安全降級
- [ ] round-trip fixture 的 export 半段覆蓋多 project、global special entries、Unicode/tags、空 store 與 concurrent revision

## Blocked by

- 04 — JSON → SQLite 原子遷移與 authority cutover
- 08 — Learning／Settings 即時 Host UI Projection
