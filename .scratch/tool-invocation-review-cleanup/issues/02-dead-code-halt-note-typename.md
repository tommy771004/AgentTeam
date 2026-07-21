# 02 — 死碼清除、truncate-only 註記、builtin 型別邊界

**What to build:** 在 01 的單一組裝就緒後，清掉 heuristic 搬走後的 orphan API（確認零呼叫的 guard+execute 組合入口、未使用的 deny 字串 helper 等），在門控 seam／heuristic 接線寫清 phase 1 **只 truncate**（不靜默假裝 Settings halt 對 heuristic 生效），並讓 builtin 工具名以既有工具名型別進入 execute、去掉 `Parameters<typeof executeTool>` 類 cast。FC 路徑本票不遷 seam。

**Blocked by:** 01 — 契約收緊 + heuristic 單一組裝

**Status:** resolved

- [x] 全庫確認後刪除（或不再 export）零引用的 post-auth／guard+execute orphan；無「假 canonical 入口」
- [x] `invokeGatedTool`（及 heuristic 組裝處）註解標明 phase 1 truncate-only 與 halt 非本路徑語意
- [x] builtin execute 不再使用模糊 cast；型別來自 registry／ToolName 邊界
- [x] 既有 smoke 仍綠；若有 drift-guard，鎖 orphan 名稱不回流
- [x] function-calling 工具尾巴無義務變更（不接 `invokeGatedTool`）
- [x] `tsc`／smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/tool-invocation-review-cleanup/spec.md`
- From code-review: dead `guardAndExecuteTool` / `authToDeniedResult`, halt transparency, execute cast

## Answer

Implemented 2026-07-20:

- Deleted `guardAndExecuteTool` + `GuardResult`; deleted `authToDeniedResult`
- Module + helper comments: truncate-only; FC may still halt
- Builtin `executeTool(toolName: ToolName, …)` without cast
- Drift guards in smoke-step-executor
