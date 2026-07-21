# 02 — executor case → registered：workspace 核心 + bash

**What to build:** 將 `executeTool` 中 workspace_*、bash、table_parse、datetime_now 的 case 本體搬入對應 `registered/<name>.ts` handler。搬完後從 switch 刪除這些 case。handlers **不得**再呼叫 `executeTool`。行為 bit-for-bit。

**Blocked by:** None — can start immediately（可與 01 並行；建議 01 先合以降低心智負擔）。

**Status:** resolved

- [x] 列出工具之 handler 含原 switch I/O 邏輯
- [x] `registered/*` 無 `executeTool` import
- [x] executor switch 已無對應 case
- [x] 既有／新增 smoke 綠
- [x] `tsc`／oxlint 綠

## Answer

- workspace_* / bash / table_parse / datetime_now handlers 含原 switch I/O；共用 rewind / git settings 在 `toolIoHelpers.ts`。
- `registered/*` 無 `executeTool`；executor 無對應 case。
- smoke-registry-executor-cleanup + full smoke 綠。

## Comments

### Parent

- Spec batch 1: workspace + bash + table + datetime
