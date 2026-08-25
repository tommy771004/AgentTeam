# 09 — MCP namespacing、reload 與 bridge contraction

**What to build:** 多個 MCP server 的同名工具能穩定共存，server schema reload 只影響下一個 contract revision，不改寫 in-flight turn；native dynamic tools 成為唯一主要 model-facing contract，generic bridge 不再形成第二條可漂移的工具系統。

**Blocked by:** 08 — MCP native dynamic tool 首條切片.

**Status:** 可交給代理

- [x] 兩個 MCP sources 提供同名 tool 時產生穩定、不碰撞且可追溯的 namespaced names。
- [x] 同一 turn 中 upstream schema 改變不影響 frozen contract 或已註冊的 Pi tool。
- [x] Reload 後下一 turn 取得新 schema digest、description 與 validation semantics。
- [x] Disabled、missing、stale、schema-invalid 與 transport-failed MCP tools 各有結構化且可讀的結果。
- [x] Native tool 與 generic bridge 不得對同一 upstream tool 形成兩份 active model contracts。
- [x] Compatibility bridge 只有在 qualification 規定的過渡情況可見，最終從一般 model invocation 隱藏或移除。
- [x] Controlled MCP qualification 覆蓋 collision、reload、freeze、activation、execution 與 failure cases。

## Comments

Implemented and independently verified. Global collision assignment is shared by catalog and session discovery; generation-scoped MCP clients freeze in-flight schema/config/transport while reload advances only future turn admission. Native dynamic names are the normal model contract, with generic bridge verbs retained only for explicit compatibility activation. Catalog failures are structured, next-turn validation reflects reloaded schema, and Host shutdown releases every MCP generation. `npm run smoke:pi-mcp-reload` and `npm run build` pass with natural process shutdown.
