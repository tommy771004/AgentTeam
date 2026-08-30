# 14 — Canonical review diff fail-closed

**What to build:** Electron canonical run 的歷史 diff 永遠來自 immutable Host snapshot；snapshot capture 或 reference 缺失時誠實顯示 unavailable，而不是讀取現在的 working tree 補洞。

**Blocked by:** 05 — Finalization claim retry、release 與 drain；run-review-workspace #01–#09 已 resolved

**Status:** 可交給代理

- [ ] canonical review admission、capture failure、artifact loss 與舊 archive 缺 reference 都不讀 live working-tree diff
- [ ] summary/archive 清楚區分 snapshot、live/staged mutable target 與 legacy/ephemeral compatibility
- [ ] failed、partial、missing 與 stale 狀態保留 execution outcome，但提供正確 recovery/diagnostic
- [ ] snapshot A 在 workspace mutate、commit 或 snapshot B 後仍保持 hash、manifest 與 patch bytes 不變
- [ ] review settlement integration smoke 明確斷言 canonical failure 不 fallback 到 live diff
