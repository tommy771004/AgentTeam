# 05 — Working State 的 live、replay 與 reload UI Projection

**What to build:** 讓使用者在執行中、歷史 replay 與 renderer reload 後看到同一個 Host-owned Working State，包括 goal status、blocker 與 evidence-backed revision；沒有 Pi Host 時則誠實顯示能力降級。

**Blocked by:** 04 — Compaction、checkpoint 與 resume 保留 Working State

**Status:** 已完成

- [x] Live UI 只從 Host snapshot 加 Turn Record append events 投影 Working State，不從 activity transport 組出第二份 Pi timeline。
- [x] 同一段 record 在 live、replay、archive 與 renderer reload 後產生相同 goal ordering、status、blocker 與 revision。
- [x] Stale renderer projection 無法覆寫較新的 Host snapshot，archived/tombstoned state 不會被復活。
- [x] Evidence references 以 bounded、可理解形式呈現，不把 private durable-memory body 或 raw unbounded tool output帶入 UI。
- [x] Plain-browser compatibility path feature-detects Host capability，顯示未驗證狀態或明確 unavailable，而不宣稱 Checker-backed completion。
- [x] UI 不新增 Working State editor 或可繞過 Host Checker 的 mutation control。
- [x] Browser/reload smoke 驗證 live 與 replay 等價及 degraded mode，並已加入實際 smoke gate。
