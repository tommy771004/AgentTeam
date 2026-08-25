# 03 — Capability load 更新 Turn Tool Contract revision

**What to build:** Pi Agent 在同一 turn 發現需要 deferred capability 時，載入後立即取得該 capability 的真實工具 schema 並能呼叫；`tool_search`、Pi active tools、contract description 與下一 turn 的 conversation preference 對同一份 activation fact 達成一致。

**Blocked by:** 01 — Turn Tool Contract 首條垂直切片.

**Status:** 可交給代理

- [x] Deferred capability 在載入前只佔 compact catalog entry，完整 schema 不進入模型 active tool set。
- [x] `tool_search` 從 Turn Tool Contract 搜尋 description 與 schema metadata，不使用第二份工具 inventory。
- [x] Capability load 透過 Pi native active-tool control 在同一 turn 啟用工具並產生新的 contract revision。
- [x] 載入後按需 description、模型 active tools、Code Mode 可見名稱與 catalog active state 同步更新。
- [x] 載入前已完成的 tool calls 保留原 contract revision，不能被新 revision 改寫。
- [x] Conversation preference 讓下一 turn 預載先前 capability，但不改動上一 turn 的 frozen contract。
- [x] 真實 session smoke 證明 list → search → load → describe → call → next-turn preload 的完整路徑。

## Comments

Implemented and verified. Capability activation is session-scoped; `load_capability` updates Pi native tools and publishes a new immutable contract revision in the same turn; `tool_search`, catalog, description, and Code Mode resolve through that session contract; old revisions remain historical; reset clears activation; and the next turn preloads the revised tool set. `npm run smoke:pi-host-capability-contract` and `npm run build` pass.
