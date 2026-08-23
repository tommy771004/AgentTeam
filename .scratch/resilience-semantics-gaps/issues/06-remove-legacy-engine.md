# 06 — 移除遺留 engine 與 loopRunner

**What to build:** 滿足 ADR-0045 的刪除門檻後,把遺留的 browser-compat 執行路徑(agent engine + loop runner)整個移除,abort/timeout 從此只存在於 Pi Host 一處。刪除順序:先將相關 smoke drift guards 改指新 owner → 移除 UI 對 engine 的殘餘引用 → 砍檔;新增 source-text drift guard 斷言 repo 內零殘餘 import。**本 ticket 必須是獨立 PR,不可與其他 resilience tickets 混雜(revert 邊界隔離)。**

**Blocked by:** 01 — Abortable turn 協定(abort 能力已在生產路徑就位)、02 — Per-turn timeout、04 — Resume from checkpoint(遺留路徑的最後使用者都遷移完)

**Status:** ready-for-agent

- [ ] 相關 smoke drift guards 改指新 owner,未弱化任何 guard
- [ ] UI 層對遺留 engine 的殘餘引用移除
- [ ] engine 與 loopRunner 檔案刪除
- [ ] 新增 source-text drift guard:斷言 repo 內無殘餘 import
- [ ] 全部 build(typecheck)與 smoke 通過
- [ ] 本 ticket 以獨立 PR 交付
