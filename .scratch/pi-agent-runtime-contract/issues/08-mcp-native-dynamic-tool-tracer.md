# 08 — MCP native dynamic tool 首條切片

**What to build:** 一個 controlled MCP fixture tool 以 deterministic namespaced name 與真實 input schema 出現在 Turn Tool Contract，載入 owning capability 後成為 Pi native dynamic tool，讓模型直接呼叫，同時重用現有 Host MCP client、Approval Decision、Outbound Data Gate 與 Turn Record。

**Blocked by:** 03 — Capability load 更新 Turn Tool Contract revision; 05 — 真實 Pi tool-call qualification 與 contract identity; 06 — Policy and Evidence module 擴展切片.

**Status:** 可交給代理

- [x] Host 從 fixture MCP server 取得 description 與完整 input schema，凍結在當前 turn contract。
- [x] MCP tool 使用 deterministic namespaced model-facing name，catalog 可追溯到 extension source 與 upstream tool name。
- [x] 載入前 MCP schema 不進入 active model tools，載入後同一 turn 可直接由 Pi model 呼叫。
- [x] Execution 重用既有 Host MCP client，不新增第二個 MCP transport。
- [x] MCP invocation 走共用 policy/evidence module，並記錄 source、origin、contract digest 與完整 coordinates。
- [x] Expected upstream failure 回 structured content，transport/runtime failure 回 failed settlement。
- [x] 真實 turn qualification 證明 model schema、MCP fixture 收到的 arguments、result 與 Turn Record 一致。

## Comments

Implemented and independently verified. Enabled MCP servers are discovered through the existing cached Host client, converted into session-scoped Pi native dynamic tools with deterministic names and full provenance, and kept inactive until `mcp-bridge` is loaded. Same-turn activation republishes the contract; invocation reuses the same transport and shared policy/evidence chain. Controlled qualification covers exact model schema/arguments/results, structured upstream business failure, transport failure, and durable MCP contract identity. A final typecheck regression in failure metadata was caught by root verification and fixed. `npm run smoke:pi-mcp-native` and `npm run build` pass.
