# 15 — 真實 Pi Core collaboration release qualification

**What to build:** 以真 Pi Core Host 與 packaged Electron 路徑證明完整 collaboration lifecycle 可交付：spawn、message、follow-up、wait、completion、reload/restart recovery、conflict prevention、verified adoption 與歷史 UI 都使用同一份 Host truth。

**Blocked by:** 08 — Agent retention、ack、close 與 recovery; 10 — Verified worktree isolation; 11 — Sibling-settled Checker adoption; 12 — 對話中的 Agent Work Tree UI; 14 — Renderer delegation expand–contract 收口.

**Status:** 可交給代理

- [ ] 真 Pi parent/child 執行 spawn、queue-only message、follow-up、event-driven wait 與 one-hop completion
- [ ] Renderer reload 與 Host restart scenario 都不遺失或重複 terminal result
- [ ] 兩個 writer 的 overlap 在 effect 前被拒且受保護檔案 hash 不變
- [ ] Verified worktree child 不修改主 checkout，結果可由 review workflow 顯示
- [ ] Valid delegated evidence 可採用，stale/unverified evidence 不改 Working State
- [ ] Previous-turn child activity 不出現在下一輪 active surface，archive/replay 仍可展開
- [ ] Build、lint、完整 smoke、package-time smoke 與 dist gate 全綠
- [ ] Qualification、tracker index 與 DEV_STATE 一 hop 對帳後才可標 resolved
