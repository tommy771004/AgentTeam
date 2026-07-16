# 02 — MCP 依 metadata 分類，且核准前可觀測不傳輸

**What to build:** 使用者透過 generic MCP 呼叫外部工具時，系統依目標工具名稱**與可用的 server／tool metadata（如 operation class）**判斷是否為寫入類副作用；預設 auto／always 與無人值守路徑在核准前不得對寫入類目標發起傳輸。測試必須能觀察「transport 次數」，而不只靠原始碼順序推斷。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [x] 目標工具帶 write／destructive／external 類 metadata 時，auto 模式在執行前要求核准。
- [x] 無 metadata 時仍以保守名稱啟發式分類；read 類 metadata 的讀取目標不因誤報而強制寫入核准。
- [x] 無人值守 run 無法靜默通過 MCP 寫入核准；full-access 降級與 deny 優先序維持不變。
- [x] 存在可觀測 fixture：deny／pending／timeout 路徑下記錄的 MCP transport 呼叫次數為 0。
- [x] full-access 對 write-like 目標的自動核准仍可追溯（明確日誌／可審核行為），不與 bypass 混淆。

## Comments

### 2026-07-16 — TDD slice

- Seam: `resolveMcpSideEffectMeta` + `isMcpWriteLikeInvocation(…, meta)` + `invokeMcpAfterAuthorization`.
- Metadata from input.operationClass / nested meta / optional catalog by target name; metadata wins over name heuristics.
- `authorizeTool` resolves meta before write classification; unattended + full-access log path unchanged.
- Observable transport: pure `invokeMcpAfterAuthorization` proves deny → transportCalls 0.
- Schema: optional `operationClass` on `mcp_call`.
