# 15 — 真實 Pi Core collaboration release qualification

**What to build:** 以真 Pi Core Host 與 packaged Electron 路徑證明完整 collaboration lifecycle 可交付：spawn、message、follow-up、wait、completion、reload/restart recovery、conflict prevention、verified adoption 與歷史 UI 都使用同一份 Host truth。

**Blocked by:** 08 — Agent retention、ack、close 與 recovery; 10 — Verified worktree isolation; 11 — Sibling-settled Checker adoption; 12 — 對話中的 Agent Work Tree UI; 14 — Renderer delegation expand–contract 收口.

**Status:** resolved（2026-08-30；本機 qualification 完成；signed/notarized publication 仍需外部 Apple credentials）

- [x] 真 Pi parent/child 執行 spawn、queue-only message、follow-up、event-driven wait 與 one-hop completion
- [x] Renderer reload 與 Host restart scenario 都不遺失或重複 terminal result
- [x] 兩個 writer 的 overlap 在 effect 前被拒且受保護檔案 hash 不變
- [x] Verified worktree child 不修改主 checkout，結果可由 review workflow 顯示
- [x] Valid delegated evidence 可採用，stale/unverified evidence 不改 Working State
- [x] Previous-turn child activity 不出現在下一輪 active surface，archive/replay 仍可展開
- [x] Build、lint、完整 smoke、package-time smoke 與 explicit unsigned-local dist gate 全綠；signed/notarized publication 因本機沒有 Apple credentials fail closed
- [x] Qualification、tracker index 與 DEV_STATE 一 hop 對帳後才可標 resolved
