# 14 — Renderer delegation expand–contract 收口

**What to build:** 將既有 renderer delegation 的 persona、batch、worktree 與 runner 選擇能力轉接到 Host-owned Agent Communication Domain，逐步移除第二套 budget、lifecycle、completion 與 production executor，讓所有入口使用同一個 Task run coordinator 與 Pi Host authority。

**Blocked by:** 04 — Follow-up task 與 profile continuity; 07 — Safe interrupt 與 descendant cancellation; 10 — Verified worktree isolation; 11 — Sibling-settled Checker adoption; 13 — External CLI collaboration capability honesty.

**Status:** 可交給代理

- [ ] Expand 階段提供相容 adapter，既有 caller 不需一次全部改寫且主鏈保持綠
- [ ] Persona 只影響 instructions/model，不放寬 capability、approval、sandbox 或 write authority
- [ ] Batch 使用 Host tree budget 與 lifecycle，不保有 renderer-global counter
- [ ] Worktree 選擇走 verified Host mode，不再有 silent shared-workspace fallback
- [ ] Builtin 與 external CLI runner 都使用各自 honest collaboration contract
- [ ] 所有 delegate entry 仍經唯一 Task run coordinator admission/finalization
- [ ] Contract 階段刪除或凍結無 caller 的第二套 production lifecycle owner
- [ ] Drift guard 證明 renderer 不可直接建立 child run、mailbox、lease 或 canonical settlement
