# 10 — 所有 invocation origins 遷移並收斂舊路徑

**What to build:** Builtins、Extension Packs、direct protocol、Code Mode 與 MCP 全部由同一 policy/evidence interface 得到 activation、Approval Decision、Outbound Data Gate、Restricted Project View、audit 與 settlement，並刪除被取代的重複推導和旁路。

**Blocked by:** 07 — Direct protocol 與 Code Mode 遷移共用決策; 09 — MCP namespacing、reload 與 bridge contraction.

**Status:** 可交給代理

- [x] 每種 invocation origin 都攜帶統一 coordinates、contract identity、origin 與 frozen run policy。
- [x] Approval Mode 三種姿態、capability-required approval、restrictive hook deny 與 unattended downgrade 在所有 origins 有一致結果。
- [x] Outbound Data Gate 與 Restricted Project View 對所有 origins 產生相同 vocabulary 的 decision 與 evidence。
- [x] File-mutating tools 繼續使用 shared per-file mutation queue，並以真實 concurrent same-path 操作證明 serialization。
- [x] Streaming 維持 byte bounds 與 spill behavior，cancellation 只產生一個 terminal settlement 且不晚到 success。
- [x] 舊的重複 approval、active-tool、audit 或 policy derivation 路徑在所有 callers 遷移後被刪除。
- [x] Drift guard 阻止新的 invocation path 繞過共用 module 或直接從 renderer 執行 production tools。

## Comments

- Pi builtins、Extension Packs、direct protocol、Code Mode、native MCP 與 compatibility MCP bridge 已收斂到同一 frozen policy/evidence seam；migration inventory 無 pending origin。
- builtin 僅保留一個 Host `tool_call` hook，bash 的 ADR-0047 判定在同一 hook 疊加；pack/direct 舊 approval 與 policy leaf 已移除。
- 專屬 qualification 覆蓋所有 origins 的 approval/outbound/view vocabulary、真實同檔併發 serialization、UTF-8 byte bound 與可讀 spill，以及 cancellation exactly-once terminal/no late success。
- 主代理獨立重跑 `npm run smoke:pi-all-origin-policy`、`npm run build`、`git diff --check`，全部通過；build 同時通過 production-owner 與 Pi contract drift guards。
