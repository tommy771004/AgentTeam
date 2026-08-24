# 10 — Utility 與 codegraph pack

**What to build:** agent 問得出結構性的問題（誰呼叫這個函式、改這裡會影響什麼），也處理得了手上的資料（解析表格、抽 JSON、讀回過長的工具輸出、知道現在幾點）。

codegraph 那組需要接到 app 自己索引的那張圖（Host 既有的 codegraph bridge），不是另建一份。

**Blocked by:** 01

**Status:** 可交給代理

- [x] `codegraph_explore` / `codegraph_status` / `codegraph_impact` / `codegraph_callers` 註冊為 extension tools，讀 app 索引的同一張圖
- [x] `table_parse` / `json_extract_lite` / `tool_output_read` / `datetime_now` 註冊為 extension tools
- [x] codegraph 工具在專案未索引時回可讀的狀態，而非錯誤
- [x] `tool_output_read` 能取回被截斷的工具輸出
- [x] 測試在單一接縫
