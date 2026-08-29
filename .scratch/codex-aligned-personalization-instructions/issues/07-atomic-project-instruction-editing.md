# 07 — 原子專案指令建立與編輯

**What to build:** 讓使用者能從 Personalization 明確建立或編輯目前 project/worktree 的 instruction file，Host 以 canonical target、observed hash、compare-and-swap 與 atomic replacement 保護外部 IDE 變更，避免 UI draft 靜默覆寫較新的檔案。

**Blocked by:** 05 — 階層 override 與 fallback discovery.

**Status:** 可交給代理

- [x] Missing source 只在使用者按下明確 create action 後建立，且 target 限於目前 canonical project/worktree 的合法 instruction filename。
- [x] Edit projection 帶 observed content hash；save 使用 compare-and-swap，stale draft 回傳 conflict 而不覆寫檔案。
- [x] Successful save 使用 atomic replacement，commit 後才發布 source revision／projection invalidation。
- [x] External editor change 在 bounded watcher／refresh 後更新 projection，且不被舊 renderer state 回寫。
- [x] Permission、read-only、disk-full、rename 與 encoding failure 不可破壞原檔或回覆 success。
- [x] 開啟、建立、編輯與 conflict recovery 均有清楚鍵盤可達的 UI outcome。
- [x] 寫入後下一個 resolver snapshot 使用新 hash；既有 run 是否更新由 snapshot lifecycle contract 決定而非 file editor 決定。
- [x] Temporary project smoke 驗證 create、save、external conflict、atomic failure 與 Git-visible file body。
