# 05 — delegate handlers 收尾 + 清空／刪除 executeTool switch

**What to build:** 將 `delegate_task`／`delegate_status` 的 I/O 完全放在 registered handlers（內部只呼叫 `runTask`／status API）。刪除 `executeTool` 大 switch；executor 檔若保留僅為共用 primitive（無 ToolName switch）。全庫 builtin 路徑只經 `dispatchRegistered`。drift-guard 鎖住終態。

**Blocked by:** 01 — 物理刪除 runDelegatedTask export；04 — executor case → registered：codegraph / design / ask_user

**Status:** resolved

- [x] delegate_* handlers 不經 executeTool
- [x] 不存在 `switch (tool)` 式 executeTool（函式刪除或僅 re-export dispatch 且無 case——**優先刪除**並改呼叫點）
- [x] `registered/*` 與 toolLoop／stepStrategies 無 executeTool 依賴（handlers 可用 toolIo helpers）
- [x] smoke：registryHandlersComplete；無 runDelegatedTask；無 executor tool switch
- [x] `tsc`／smoke 全鏈／oxlint 綠

## Answer

- `delegate_task` / `delegate_status` 不經 executeTool；委派走 `spawnDelegateViaRunTask` / status API。
- `executor.ts` 僅 re-export helpers，無 `switch (tool)`、無 `export async function executeTool`。
- package.json `smoke` + `smoke:ci` 掛入 `smoke-registry-executor-cleanup.mts`。
- `npm run smoke` + `tsc -b` 綠。

## Comments

### Parent

- Spec 終態 contract；Hermes registry.dispatch 唯一入口
