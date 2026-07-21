# 05 — P3：單一 conversation／Loop run 編排（撤策略公開 seam）

**What to build:** 對齊 Hermes `run_conversation` 心智：Loop run 編排收束為**單一核心**（巨石可接受）。公開的 StepExecutor 三策略 factory **不再是產品 seam**（搬家期可 private，結束時刪或僅 loop 內部）。FC／heuristic／sim 若仍存在，僅為 loop 內部 path。Tool／registry／context 保持為可呼叫零件。

**Blocked by:** 04 — P2：ContextEngine + Hermes 向壓縮

**Status:** resolved

- [x] 單一 Loop run／conversation 編排入口為主故事（engine 不再依賴對外三策略 factory）
- [x] 公開 `create*StepExecutor`／策略 seam 已撤或降為 private 並在票末清掉對外依賴
- [x] 既有 pure helpers 僅作內部工具，不支撐第二套編排敘事
- [x] smoke／drift-guard：編排入口與「無公開策略 seam」不變量
- [x] `tsc`／smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/hermes-aligned-runtime/spec.md` P3 / 決策 17C, 18 與 Hermes 對齊

## Answer

P3 residual pass (2026-07-20):
- `conversationLoop.ts` + stepStrategies marked **@internal** (not product seam)
- Product ingress remains `runTask` → engine; strategies only for engine path selection

