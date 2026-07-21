# 03 — P1：Hermes 全套 Registry（big bang）

**What to build:** 引入 Hermes 式 tool registry：每工具獨立模組、import-time `register()`、AST／掃描 discover。Catalog／schema／關鍵字等**由 registry 導出**。本 phase 以 big bang 結束：舊 `toolDefinitions`／executor 大 switch 不再是權威來源（刪除或純 re-export）。Dispatch 與 `invokeGatedTool` 對接。

**Blocked by:** 02 — P0b：FC gated（builtin+custom+MCP）→ invokeGatedTool

**Status:** resolved

- [x] registry + discover + per-tool modules 覆蓋既有 builtin（及本 phase 範圍內工具）
- [x] 對外 definitions／schema 視圖來自 registry，無第二手維權威
- [x] 生產 dispatch 不依賴舊 executor 窮舉 switch 作為權威
- [x] 與 invocation 整合：gated 執行經 register handler 或等價
- [x] smoke：discover 完整性、未知工具錯誤形狀、抽樣／窮盡註冊
- [x] `tsc`／smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/hermes-aligned-runtime/spec.md` P1 / 決策 14B, 15B
- Risk: big bang — P0 必須已綠

## Answer

P1 (2026-07-20, residual pass):
- `tools/registered/*.ts` — **47** self-registering per-tool modules + index
- `toolRegistry.discoverRegisteredToolModules` + `dispatchRegistered`
- toolLoop discovers registry and prefers registry handlers for gated builtins
- smoke: `registryHandlersComplete()`

