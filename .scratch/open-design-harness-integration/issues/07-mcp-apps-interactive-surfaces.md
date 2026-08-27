# 07 — MCP Apps direction、form、confirmation surfaces

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓相容 plugin 可在 SubDesign conversation 中呈現 direction choice、input form 與 confirmation 三種 sandboxed interactive surfaces，並透過 schema-validated host bridge 回傳結果。任何 surface 都必須有 native fallback。

## Acceptance criteria

- [ ] Contract v1 可宣告 choice、form 或 confirmation surface 及其 run/conversation/project persistence scope。
- [ ] Surface 在 sandboxed iframe 中執行，使用受控 origin、CSP、navigation 與 resource policy，不能取得 Electron/Node authority。
- [ ] Iframe-to-host 和 host-to-iframe messages 都經 versioned schema validation；未知或 malformed payload 被拒絕並記錄安全原因。
- [ ] 每個 surface 只有明確 tool allowlist；UI 不能自行呼叫任意 Pi Core tool、connector 或 network endpoint。
- [ ] Raw tokens 永遠不傳入 surface；需要 connector 的操作由 host/Pi Core 代理並遵守 approval policy。
- [ ] Direction choice 可回填 SubDesign direction，form 可保存與恢復 draft，confirmation 可完成或拒絕 pending action。
- [ ] Surface loading、submitted、invalid、expired 與 unavailable 狀態會投影到 conversation，不以 spinner 取代所有執行訊息。
- [ ] Iframe crash、unsupported host 或 feature flag disabled 時，自動使用 native choice/form/confirmation fallback。
- [ ] Security smoke 覆蓋 untrusted origin、disallowed tool、malformed bridge、prohibited navigation、oversized payload 與 valid submission。
- [ ] Surface failure 本身不會跳過必要 input，也不會繞過 Task run coordinator 或 unique finalization。

## Blocked by

- 03 — 第一條 contract-driven pipeline Task run

## Implementation note (2026-08-27)

先前合法 `tool_call` 通過 allowlist 後會靜默 no-op，現已改為 renderer native approval → main-process IPC 二次驗證 → Pi Host `mcp_call` pack；結果以 versioned `tool_result` 回傳 iframe，raw connector token 不進 renderer。`smoke-open-design-providers.mts` 覆蓋合法呼叫、malformed/disallowed 拒絕與各 surface 狀態。整張票仍包含 persistence、native fallback 與完整 conversation projection 等較大範圍，故維持 `可交給代理`，不以這次修復冒充全數完成。
