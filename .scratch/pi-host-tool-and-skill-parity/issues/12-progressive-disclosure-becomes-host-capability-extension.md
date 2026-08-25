# 12 — Progressive disclosure 搬到 Host 的 Capability Extension

**What to build:** 目錄變大時，使用者的 context 預算不會被這次任務根本用不到的工具吃掉：未載入的 capability 只佔一行目錄，需要時 agent 自己 `load_capability` 把 schema 與 runbook 叫出來；同一個對話的下一輪會預載上一輪載過的東西，不必重新摸索。

今天這整套跑在 renderer 的 capability runtime 上，而 renderer 不執行任何東西。依 ADR-0028，Pi Core 是唯一的 tool loop 與 tool 定義來源，progressive disclosure 要建在 Pi 自己的 tool catalog 與 active-tool 控制上。

**Blocked by:** 01

**Status:** 可交給代理

- [x] Host 的 `PiCapabilityCatalog` 納入 14 個 capability 定義，驅動 `pi.setActiveTools()` 與 Dynamic Tool Loading
- [x] `deferLoading` 的 capability 只顯示一行目錄；`capabilities/load` 後 `tools/list` 隨之改變
- [x] `load_capability` / `tool_search` / `run_code` 維持保留字
- [x] 超過 `toolSearchThreshold` 後非核心 schema 藏在 `tool_search` 之後，且 `tool_search` 找得到
- [x] 每個 thread 上次載入的 capability id 與解鎖工具在下一輪預載（renderer 端的持久化已由 thread prefs sidecar 保住，本回合 active 的權威在 Host）
- [x] 未註冊工具所屬的 capability 誠實回報，不假裝可用
- [x] 測試在單一接縫：`capabilities/list` → `load` → `tools/list` 變化 → 跨 turn 預載

> 落地註記：threshold 的「數量觸發」在 Host 端由**結構性**揭露取代——非核心 schema 一律預設 deferred（一行目錄、`tool_search` 找得到、`load_capability` 揭露），不論目錄大小；核心（always-on）工具不受影響。揭露權威集中在 `piActivePackToolNames()`，投影／session runtime／Code Mode 三處共用同一公式。
