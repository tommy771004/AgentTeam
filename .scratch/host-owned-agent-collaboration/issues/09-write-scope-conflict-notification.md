# 09 — Host-owned write scope 與 conflict notification

**What to build:** write-capable child 在 admission 時取得 canonical project-relative scope 與 Host-owned lease。Disjoint writers 可並行；重疊或不明確的 writer 在 effect 前 fail closed，並向雙方與最近共同 parent 發送 structured conflict event。

**Blocked by:** 02 — 統一 Child Pi Session spawn admission; 03 — Durable queue-only agent mailbox.

**Status:** resolved（2026-08-30；見 `../qualification.md`）

- [x] Child workspace mode 明確區分 shared-readonly、shared-leased-write、isolated-worktree
- [x] Shared writer 未帶 bounded project-relative scope 時不允許 effectful admission
- [x] Canonicalization 防止相對路徑、symlink/alias 或路徑穿越繞過 overlap 判定
- [x] Disjoint lease 可同時持有，overlap 在寫入前阻擋且目標檔案未改變
- [x] Conflict event 包含 bounded resource、lease owner、revision 與可採取的 resolution choices
- [x] Event 恰好一次送給衝突雙方和最近共同 parent
- [x] 只有 authorized parent/root 可 narrow、transfer、release 或 serialize lease
- [x] Protocol/E2E smoke 驗證 conflict communication，不靠模型文字判斷衝突
