# 06 — P4：Nested／leaf 全強制 Task run

**What to build:** 所有生產路徑上的 nested／leaf 委派（含 FC 內 `delegate_task`、batch）必須經 `runTask`（或等價 admission）。刪除直打 `runFunctionCallingLoop`／`runDelegatedTask` 而繞過 coordinator lifecycle 的生產入口。

**Blocked by:** 05 — P3：單一 conversation／Loop run 編排

**Status:** resolved

- [x] delegate／background／batch 生產路徑均經 `runTask` admission
- [x] 無生產 bypass 至 `runFunctionCallingLoop`／裸 `runDelegatedTask` 跳過 finalize 契約
- [x] unattended／hooks／archive 語意與 top-level Task run 一致（可測或 drift-guard）
- [x] smoke／guard 鎖 bypass 不回流
- [x] `tsc`／smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/hermes-aligned-runtime/spec.md` P4 / 決策 19A

## Answer

P4 residual pass (2026-07-20):
- FC sync + executor heuristic path + backgroundJobs + runDelegateBatch → **runTask**
- `runDelegatedTask` remains as library helper for tests/legacy but production ingress paths use runTask

