# 01 — Turn Tool Contract 首條垂直切片

**What to build:** Pi Core Host 能從一個真實 Pi session 擷取該 turn 實際交給模型的一個 builtin tool 與一個 Extension Pack tool，凍結完整 input schema、來源、active state 與穩定 schema digest，並讓呼叫端透過 versioned Pi Host Protocol 按需查詢。使用者與維護者第一次能從 Host 本身回答這個 turn 的模型看見了什麼，而不必參照 renderer schema。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [x] 每個 Pi turn 在模型執行前產生 immutable contract revision，至少包含一個 builtin 與一個 always-active Extension Pack tool。
- [x] Contract 來自 Pi session 實際暴露的工具，而不是重新讀取 renderer catalog。
- [x] 完整 model-visible schema 會先 canonicalize 再計算 digest；物件 key 順序不同不改變 digest，schema 語意改變會改變 digest。
- [x] Versioned Host protocol 可按 session、contract revision 與 tool name 查詢完整 contract。
- [x] 查詢未知、inactive、stale revision 或不屬於該 session 的 contract 時回明確結構化錯誤。
- [x] 一個 spawn shipped Host over stdio 的 smoke 證明兩種工具的 schema、source、active state、revision 與 digest 可觀察。
- [x] Pi Core 仍是唯一 production tool loop，沒有新增 renderer executor 或中央工具執行 switch。

## Comments

Implemented and verified. The shipped-host smoke compares the provider's actual model-visible tools with the Host contract, covers per-tool and aggregate digests, feature negotiation, unknown/inactive/current/historical lookups, reset monotonicity, restart persistence, and malformed persisted state. `npm run build` passes after the contract changes.
