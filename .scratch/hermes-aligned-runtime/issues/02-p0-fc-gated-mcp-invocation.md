# 02 — P0b：FC gated（builtin+custom+MCP）→ invokeGatedTool

**What to build:** 在 intercept 之後，function-calling 的 builtin、custom 與 **MCP** 一律走 `invokeGatedTool`。擴充 invocation 支援 halt（rethrow SupervisorViolation）；deny／execute throw／軟失敗對模型必有 tool 字串。heuristic 仍 truncate-only。P0 結束後不留長期 mcp residual 桶。

**Blocked by:** 01 — P0a：Agent-level intercept 表

**Status:** resolved

- [x] FC builtin/custom/MCP 經 `invokeGatedTool`（與 heuristic 同 seam）
- [x] `invokeGatedTool` 支援 halt 旗標；開 halt 時 rethrow `SupervisorViolation`
- [x] deny／throw／軟失敗 → `role: tool` 字串；halt 為唯一允許中止例外
- [x] 無長期 MCP 第三桶；搬家中間態在本票結束前收斂
- [x] smoke 覆蓋 FC 接線、MCP adapter、halt、字串契約
- [x] `tsc`／smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/hermes-aligned-runtime/spec.md` P0 / 決策 5B, 6A, 12A

## Answer

- FC gated path (not post-auth agent-level) → invokeGatedTool including MCP
- haltOnPayloadOverflow on invokeGatedTool
- smoke-tool-invocation halt case
