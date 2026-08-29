# 10 — 個人化 export、import 與 recovery

**What to build:** 讓使用者能安全搬移或復原 DB-owned personality 與 custom instructions：匯出前警告 plaintext user data，匯入先 preview 衝突再 atomic commit，corrupt／unsupported repository 進入 visible degraded state；project instruction files 只留來源摘要，不被暗中複製進 bundle。

**Blocked by:** 03 — 舊個人化資料遷移與重複 UI contraction; 08 — Revision events 與 run snapshot isolation.

**Status:** resolved

- [x] Export bundle 具有 schema version、DB-owned records、revision、hash 與 integrity metadata，並在產生前取得 plaintext warning confirmation。
- [x] Filesystem project instruction body 不進入 personalization bundle；需要時只包含不具回寫能力的 source summary。
- [x] Import 在任何寫入前顯示 add/update/unchanged/conflict/invalid preview。
- [x] 使用者確認後，valid records、operation marker 與新 revision 在單一 transaction commit；任一失敗保持原 live state。
- [x] 重複匯入同一 bundle idempotent，較舊 revision 不可無提示覆蓋較新 local record。
- [x] Integrity failure、unsupported schema、corrupt database 與 migration failure 是可區分的 degraded states，不得自動建立空白 authority 覆蓋證據。
- [x] Safe read-only export/recovery 在可行時保持可用，runtime injection 不可把 unreadable store 當成空設定。
- [x] Restart/crash smoke 驗證 preview-first、atomic import、idempotency、corruption 與 filesystem exclusion。
