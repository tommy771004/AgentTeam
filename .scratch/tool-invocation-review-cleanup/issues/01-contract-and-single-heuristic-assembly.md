# 01 — 契約收緊 + heuristic 單一組裝

**What to build:** 收緊門控 Tool Invocation 的公開契約，並刪掉 heuristic 策略裡 builtin／custom 兩套複製的 `invokeGatedTool` 組裝。呼叫端只提供 tool／input／auth 旗標／execute；authorize 形狀與 guard 對齊（或僅在 invocation 模組內 normalize 一次）；結果的 `denied` 永遠是 boolean；拿掉未使用的 input 欄位（例如未讀的 settings）。既有 deny／throw／afterTool／truncate 行為不變。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `invokeGatedTool` 結果型別中 `denied` 為必填 boolean（deny → true，其餘 → false）
- [x] 公開 input 不再含未使用的假契約欄位；authorize／execute 仍為可注入（預設不靠幽靈 settings）
- [x] 呼叫端不必各自寫 AuthorizeResult remap ternary；形狀在 seam 對齊
- [x] heuristic 的 builtin 與 custom 共用**一個**組裝 helper（或同等單一函式），兩 loop 不再各貼一整段 invoke 選項
- [x] phase 1 產品語意不變：結構化 deny／execute throw、deny 不 afterTool、supervisor truncate-only
- [x] `smoke-tool-invocation`（及必要的 wiring 斷言）更新且綠；真 import，非行為鏡像
- [x] `tsc`／相關 smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/tool-invocation-review-cleanup/spec.md`
- Upstream: `.scratch/tool-invocation-pipeline/`（phase 1 resolved）
- From code-review: dual-loop blocker + authorize remap + optional denied + dead `settings?`

## Answer

Implemented 2026-07-20:

- `denied: boolean` always; dropped unused `settings?`; `GatedAuthorizeResult = AuthorizeResult`
- `runHeuristicGatedTool` single assembly; builtin/custom loops thin
- smoke-tool-invocation asserts `denied === false`; guard-shaped authorize test
- smoke-step-executor asserts `runHeuristicGatedTool` + no `as const` remap
