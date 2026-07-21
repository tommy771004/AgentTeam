# 03 — executor case → registered：memory / skill / web / mcp / 雜項

**What to build:** 遷移 memory_*、skill_*、web_search、http_fetch、mcp_list_tools、mcp_call、monitor、message_send、json_extract_lite、update_plan 的 case 進入 registered handlers；刪 switch arms；無 executeTool 回呼。

**Blocked by:** 02 — executor case → registered：workspace 核心 + bash

**Status:** resolved

- [x] 上述工具 handler 自持 I/O
- [x] registered 無 executeTool import
- [x] executor 無對應 case
- [x] smoke 綠
- [x] `tsc`／oxlint 綠

## Answer

- memory_* / skill_* / web_search / http_fetch / mcp_* / monitor / message_send / json_extract_lite / update_plan 均為自持 handler。
- 無 executeTool 回呼；dispatch 僅 `dispatchRegistered`。

## Comments

### Parent

- Spec batch 2–3
