# 01 — 物理刪除 runDelegatedTask export

**What to build:** 從程式庫完全移除 `runDelegatedTask` 匯出與實作。委派只透過 `delegate_task` 工具路徑與／或 `runTask`。全庫（src + scripts）零引用；註解不再暗示存在該 API。對齊 Hermes：無第三個公開 nested-loop 符號。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `hermes/delegate.ts` 不再 export `runDelegatedTask`（函式體刪除或內聯到非 export 私有且無呼叫者）
- [x] `app/src` 與 `app/scripts` 無任何 `runDelegatedTask` 引用
- [x] `runDelegateBatch` 若保留，僅經 `runTask`（已然則只清 import／文件）
- [x] smoke／drift-guard 鎖符號不回流
- [x] `tsc`／相關 smoke／oxlint 綠

## Answer

- 物理刪除 `export async function runDelegatedTask`；全庫（src）零符號引用。
- 巢狀委派僅經 `spawnDelegateViaRunTask` → `runTask`，或 `delegate_task` / `runDelegateBatch`。
- G9 persona / worktree / capability_mode / hooks 搬入 `prepareDelegateSpawn` + `spawnDelegateViaRunTask`（非第三個 public nested-loop 符號）。
- Drift: `scripts/smoke-registry-executor-cleanup.mts` 鎖 `runDelegatedTask` 不回流。
- `tsc` / `npm run smoke` 綠。

## Comments

### Parent

- Spec: `.scratch/hermes-registry-executor-cleanup/spec.md`
- Hermes: delegate_tool handler → AIAgent；無 runDelegatedTask
