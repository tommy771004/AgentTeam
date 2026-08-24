# 18 — Contract：刪掉 renderer 目錄與 Hermes 技能，補上 drift guard

**What to build:** 產品只剩一套工具系統與一套技能探索。這是 expand–contract 的 contract 階段 —— 前面每一張票都是在舊的旁邊加新的，這張票在確認沒有呼叫端之後把舊的拿掉。

**這張票同時處理排查 session 留下的 ADR 債**：止血用的 `agent/piTurnContext.ts` 技能注入在 renderer 端用 Hermes `skillsStore` 解析技能塞進 prompt，牴觸 ADR-0034（Pi resource loader 是技能的唯一進入點）。它從第一天就被排定在這裡退場。`piTurnContext` 的專案指引與對話歷史部分**不動** —— 那不是 resource discovery，不受該 ADR 管。

**Blocked by:** 04, 05, 06, 07, 08, 09, 10, 11, 12, 14, 15, 16, 17

14 與 15 是硬阻擋：這張票會刪掉 renderer 剩餘的工具註冊，而那六個與 Pi builtin 等價的工具依 ADR-0027 只能在各自的 parity 證明通過後才被授權刪除。跳過它們就是無證據刪除。

**Status:** 可交給代理

- [x] 刪除 `hermes/skills.ts` 與 renderer 的 `skill_list` / `skill_load` / `skill_save`
- [x] 刪除 `piTurnContext` 的技能分支；專案指引與對話歷史注入保留
- [x] 刪除 renderer 端已被 Host 取代的工具註冊與 `toolDefinitions.ts` 的目錄角色
- [x] Drift guard：`agent/tools/registered/` 出現新檔案時 build 失敗
- [x] Drift guard：新增對 `hermes/skills.ts` 的 import 或字串引用時 build 失敗
- [x] `npm run build` 與 `npm run smoke` 全綠
