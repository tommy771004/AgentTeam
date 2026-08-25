# 06 — Memory pack 接上 Host 的 memory extension

**What to build:** agent 這一輪記住的事，下一輪召回得到。今天有**兩個互不相干的記憶體**：renderer 的 `memoryStore`（`memory_*` 工具寫進去的，但那些工具在 production 叫不動）與 Host 的 `PiMemoryExtension`（`turn/submit` 真正會 recall 的那個）。使用者以為 agent 記住了，其實寫進了一個沒人讀的地方。

排查 session 裡的 `piTurnContext` 之所以刻意跳過 memory slot 並註記原因，就是為了不製造第三份分歧副本。這張票收斂成一份。

**Blocked by:** 01

**Status:** 可交給代理

- [x] `memory_set` / `memory_get` / `memory_append` / `memory_search` 註冊為 extension tools，讀寫 Host 的 `PiMemoryExtension`
- [x] 一個 turn 寫入的記憶，在後續 turn 的 `memory/recall` 與 `memory_search` 都取得到
- [x] 既有的 decay / staleness 語意（自動記憶衰減、手寫與 curated 不衰減）在 Host 端保持一致
- [x] temporary chat 不讀不寫記憶
- [x] 測試在單一接縫：跨兩個 turn 斷言寫入與召回
