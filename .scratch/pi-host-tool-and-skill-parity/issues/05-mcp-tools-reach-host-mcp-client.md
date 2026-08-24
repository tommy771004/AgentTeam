# 05 — MCP 面向模型的工具接上 Host 的 MCP client

**What to build:** 使用者設定好的 MCP server，agent 在對話裡列得出它的工具、也叫得動。今天 `mcp_list_tools` / `mcp_call` 只存在於 renderer，模型在 production 拿不到。

Host 端該有的都有了 —— `tools/mcp`、`piMcpClient`、`listPiMcpTools` 都在，`tools/list` 也已經會把 MCP extension 的工具攤進來。缺的是模型面向的那兩個工具。

**Blocked by:** 01

**Status:** 可交給代理

- [x] `mcp_list_tools` / `mcp_call` 註冊為 extension tools，走 Host 既有的 MCP 路徑
- [x] 列出的工具與 `tools/list` 攤平出來的 MCP 工具一致，沒有第二份清單
- [x] 未啟用或不存在的 extension id 回結構化錯誤
- [x] 走同一套 Approval Decision（比照既有 `tools/mcp` 的核准處理）
- [x] 測試在單一接縫，用既有的 MCP fixture
