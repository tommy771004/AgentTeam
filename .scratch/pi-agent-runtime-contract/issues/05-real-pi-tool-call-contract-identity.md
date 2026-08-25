# 05 — 真實 Pi tool-call qualification 與 contract identity

**What to build:** Qualification 透過 shipped Pi Core Host 啟動真實 Pi turn，使用 deterministic provider fixture 讓模型呼叫一個 builtin 與一個 Extension Pack tool，證明 model-visible contract、實際 invocation、result 與 durable Turn Record 指向同一個 contract revision 和 schema digest。

**Blocked by:** 01 — Turn Tool Contract 首條垂直切片.

**Status:** 可交給代理

- [x] Deterministic provider fixture 經 production Pi session path 產生工具呼叫，不直接呼叫工具實作。
- [x] 至少一個 builtin 與一個 always-active Extension Pack tool 在真實 turn 中成功執行。
- [x] Tool-call 與 tool-result 記錄 contract revision、schema digest、source 與 invocation origin。
- [x] Host protocol description 的 digest 與真實 tool-call / tool-result 中的 digest 完全一致。
- [x] 一個只被 catalog 列出但未進入模型 active tools 的工具不能通過 qualification。
- [x] Expected tool failure 以 structured content 回到 Pi turn，不能因 throw 提前終止整個 run。
- [x] Smoke 只觀察 protocol、events、filesystem fixture 與 Turn Record，不斷言 private registry 或 source text。

## Comments

Implemented and independently verified. A deterministic provider now drives the shipped Pi session through model-originated builtin `read`, always-active `update_plan`, and an expected structured `tool_search` failure. Tool-call and tool-result records freeze the same revision, schema digest, source/pack, and model invocation origin, survive persistence and Host restart, and match `tools/contract`; inactive `http_fetch` remains outside every model request. `npm run smoke:pi-real-tool-contract` and `npm run build` pass.
