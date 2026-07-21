# 02 — Heuristic 接上並吸收 finalize

**What to build:** 讓 heuristic 步驟策略上的 builtin 與 custom 工具改走 `invokeGatedTool` 端到端，使 phase 1 的生產路徑真正使用新 seam。吸收並移除舊的「核准後收尾」公開 helper（不留長期雙 API）；既有依賴 finalize 的 smoke／呼叫改鎖新路徑。function-calling 的工具尾巴本票**完全不動**。

**Blocked by:** 01 — 門控 Tool Invocation 模組 + 行為 smoke

**Status:** resolved

- [x] Heuristic 路徑對 builtin 與 custom 呼叫 `invokeGatedTool`（含 authorize／執行／truncate／record／afterTool 語意與 01 一致）
- [x] 舊 finalize 類公開 API 已吸收：生產碼與公開 export 不再雙軌維護同一收尾
- [x] 既有 step-executor／相關 smoke 改為驗證 heuristic 接線或新 seam，且仍為真 import、非字串鏡像
- [x] 授權 deny、執行失敗在 heuristic 下仍以結構化結果進入 tool 輸出／record，不因搬家而改回丟例外
- [x] deny 在 heuristic 下仍不跑 afterTool；已執行路徑仍跑 afterTool（含 custom）
- [x] function-calling 工具分派／私有尾巴零行為義務變更（本票不改 FC 接線）
- [x] `tsc`／smoke（含 01 與 step-executor 等）／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/tool-invocation-pipeline/spec.md`
- Grill locks: 決策 5（先 heuristic）、10（吸收 finalize）、12（phase 1 完成線）

### Notes

- 若搬家中需極短 re-export 墊片保持中間 commit 綠，同一票內刪掉，不開「雙 API 過渡期」ticket。
- Phase 2（另 effort）：function-calling builtin／custom 改呼叫同一 seam。

## Answer

Implemented 2026-07-20:

- `stepStrategies` heuristic builtin + custom → `invokeGatedTool` (authorize adapter + execute)
- Removed `finalizeAuthorizedToolCall` / `finalizeDeniedToolCall` from `stepExecutor`
- `smoke-step-executor` wiring asserts `invokeGatedTool` and no dual finalize API
- FC path untouched (`toolLoop` still owns its private tail)
- `tsc -b` / oxlint / smoke-tool-invocation + smoke-step-executor green
