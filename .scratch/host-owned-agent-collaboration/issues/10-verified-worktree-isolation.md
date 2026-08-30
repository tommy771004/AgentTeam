# 10 — Verified worktree isolation

**What to build:** 無法證明 write scopes 不重疊的 child 使用 verified isolated worktree。隔離建立、workspace identity 或 sandbox 驗證失敗時阻擋執行，不再靜默回退共享 checkout；完成後只提供 review/integration handoff。

**Blocked by:** 09 — Host-owned write scope 與 conflict notification.

**Status:** 可交給代理

- [ ] Isolated child 的 worktree、branch、baseline 與 workspace identity 由 Host 建立並記錄
- [ ] 建立或驗證失敗時 lifecycle 進入 blocked/failed，不執行共享 workspace 寫入
- [ ] Isolated child 的工具 cwd 與 write lease 只能落在已驗證 worktree
- [ ] Result 帶 attribution fidelity 與 review target，不自動 merge 或 apply
- [ ] Parent 可選擇 review、explicit apply 或 discard，且每個動作沿用既有 mutation authority
- [ ] Cleanup 不刪除仍 active、未 review 或被 retention policy 保留的 worktree
- [ ] UI 清楚區分 shared-readonly、leased-write 與 isolated-worktree
- [ ] 真 Git worktree smoke 證明主 checkout 在 child 執行中未被修改
