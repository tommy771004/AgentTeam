# 01 — Host 端 extension tool 接縫，用 http_fetch 走通一遍

**What to build:** 使用者在 Electron app 裡叫 agent 去抓一個網頁，agent 真的抓得到。今天 `http_fetch` 列在設定裡但在 production 完全叫不動，因為它只存在於 renderer，而實際執行的 Pi Core Host 沒有它。

這張票建立 Host 端註冊工具的那條路，並用一個真工具證明它會動。之後每一個 pack 都照抄這個形狀，所以這裡的決定會被複製九次 —— 值得一次做對。

選 `http_fetch` 當 tracer 不是因為它簡單，是因為它會同時碰到 Approval Decision、Outbound Data Gate、Turn Record 三個既有機制。一個不碰這些的工具走通了，並不能證明下一個會。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [x] Host 端的 extension factory 用 `pi.registerTool()` 註冊工具，與既有的 `subagents-session-context` hidden factory 一起交給 `DefaultResourceLoader`
- [x] `tools/list` 回報該工具，帶 id、所屬 pack、本回合是否 active
- [x] 在一個真的 turn 裡被模型呼叫並回傳結果；失敗時回結構化失敗而非 throw
- [x] 走既有的 Approval Decision：需要核准時未核准會被拒絕、核准後放行；三種 Approval Mode 與 unattended 降級都涵蓋
- [x] 走既有的 Outbound Data Gate；protection active 時綁定 Restricted Project View
- [x] Turn Record 出現對應的 tool-call / tool-result 配對，座標正確
- [x] run 取消時停在 tool boundary（比照既有 `toolsInFlight` park 邏輯）
- [x] 測試在單一接縫：spawn `dist-electron/pi-host.js` 走 Pi Host Protocol，比照 `scripts/smoke-pi-host-capabilities.mts`
