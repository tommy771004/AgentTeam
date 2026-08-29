# 08 — Revision events 與 run snapshot isolation

**What to build:** 完成「最新設定」的生命週期：SQLite save、project file edit 或 include source change 都發布 monotonic revision，idle UI 即時更新，但已 admission 的 Task run 維持原 snapshot；下一個 run 自動使用最新 committed revision，不需重啟或重新送出設定對話。

**Blocked by:** 06 — 有界且安全的本機 include resolution; 07 — 原子專案指令建立與編輯.

**Status:** resolved

- [x] DB-owned、filesystem-owned 與 transitive include change 都映射成 monotonic Host instruction revision／invalidation event。
- [x] Renderer 只以 snapshot + after-cursor events 更新 projection，較舊 response 不可覆蓋較新 revision。
- [x] Active run 清楚顯示 instruction revision 已凍結，變更標示為「下一個 run 生效」。
- [x] Run A admission 後修改 global、project 與 included content，Run A 所有 iterations 仍使用舊 effective hash。
- [x] 另行 admission 的 Run B 不需 app restart 即使用全部最新 committed sources。
- [x] Same-thread queue 在真正 admission 時解析最新版，而不是在使用者按下送出時過早凍結 mutable sources。
- [x] Concurrent windows 的 DB save 與 project file save 都以 revision/hash CAS 防止 lost update。
- [x] Fake-clock + real Host scenario 覆蓋 running/queued/new run、event reorder、restart 與 stale renderer response。
