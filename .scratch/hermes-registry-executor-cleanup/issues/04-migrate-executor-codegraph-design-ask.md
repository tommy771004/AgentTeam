# 04 — executor case → registered：codegraph / design / ask_user

**What to build:** 遷移 codegraph_*、全部 design_*、ask_user 的 case 進入 registered handlers；刪 switch arms。

**Blocked by:** 03 — executor case → registered：memory / skill / web / mcp / 雜項

**Status:** resolved

- [x] codegraph + design + ask_user handlers 完整
- [x] registered 無 executeTool import
- [x] executor 無對應 case
- [x] smoke 綠
- [x] `tsc`／oxlint 綠

## Answer

- codegraph_* / 全部 design_* / ask_user handlers 完整；路徑相對於 `registered/` 重算。
- smoke-caps SubDesign / rewind 守衛改指 registered + toolIoHelpers。

## Comments

### Parent

- Spec batch 4–5
