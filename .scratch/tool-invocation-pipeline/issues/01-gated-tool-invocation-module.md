# 01 — 門控 Tool Invocation 模組 + 行為 smoke

**What to build:** 新增門控工具專用的 Tool Invocation 深模組，對外以 `invokeGatedTool` 一次完成：Approval Decision 適配 → 執行 → supervisor truncate → 工具呼叫紀錄 →（已執行路徑）afterTool。呼叫端與測試看到的是結構化結果（成功、授權 deny／HITL 拒絕、execute 未預期 throw 包成失敗），不是靠例外打穿 loop。deny 不跑 afterTool。authorize／execute／evaluateAfterTool 可選注入；supervisor 永遠在模組內且 phase 1 只做 truncate。用真 import smoke 鎖上述外部行為（本票可不接 heuristic 生產路徑）。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 存在可呼叫的 `invokeGatedTool`（及結果型別），語意為單一門控工具 seam，不是「先 authorize 再 finalize」兩段公開 API
- [x] 授權 deny／HITL 拒絕 → 結構化結果（含明確 denied 標記、失敗 record），不丟例外；**不**呼叫 afterTool
- [x] execute 成功 → ok；afterTool 以成功語意被呼叫（可注入 spy 驗證）
- [x] execute 回軟失敗或 throw → 結構化 `ok: false`（非 denied）；afterTool 仍在已執行路徑上被呼叫
- [x] 過大 output 經模組內 supervisor **truncate**（phase 1 不引入 halt 新語意）
- [x] 預設路徑可接真實 authorize／executor／hooks；測試可整支 fake authorize／execute／afterTool
- [x] 真 import smoke 套件覆蓋上述行為；不斷言原始碼字串鏡像
- [x] 範圍僅 builtin + custom 的執行分派形狀（MCP／delegate／framework 不進本模組公開路徑）
- [x] `tsc`／相關 smoke／oxlint 綠（新 smoke 納入專案 smoke 指令鏈）

## Comments

### Parent

- Spec: `.scratch/tool-invocation-pipeline/spec.md`
- Grill locks: 決策 1–16（2026-07-20）

### Notes

- 舊 `finalizeAuthorizedToolCall`／`finalizeDeniedToolCall` 的**吸收與刪除**留到 02；本票可先實作完整管線（含 deny 建 record），不必強求生產呼叫端已切換。
- 建議結果形狀（來自 grilling，非 prototype demo）：`{ ok, output, record, chunk, denied? }`。

## Answer

Implemented 2026-07-20:

- `app/src/agent/tools/toolInvocation.ts` — `invokeGatedTool`
- `app/scripts/smoke-tool-invocation.mts` — 6 true-import cases (deny / success / soft-fail / throw / truncate / onRecord)
- Wired into `package.json` `smoke` + `smoke:ci`
