# 01 — P0a：Agent-level intercept 表

**What to build:** 將 function-calling 的單工具分派重排為「先 agent-level、後其餘」。同檔提供可測的 intercept 集合與 `isAgentLevelTool`（含 plan enter/exit、load_capability、tool_search、run_code、delegate_task／delegate_status）。Intercept handlers 行為 bit-for-bit；此票不要求 builtin/custom/MCP 已進 `invokeGatedTool`。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 存在明確 agent-level 名稱集合（可 export 供 smoke）
- [x] 分派順序：intercept 全處理完才進入 gated／其餘路徑
- [x] intercept 工具行為與重排前 bit-for-bit（plan／search／load／run_code／delegate）
- [x] 真 import smoke 鎖集合完整性與分派順序（非手抄整檔鏡像）
- [x] `tsc`／相關 smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/hermes-aligned-runtime/spec.md` P0 / 決策 2B, 4A, 7A

## Answer

- `agentLevelTools.ts` — AGENT_LEVEL_TOOL_NAMES, pre/post auth partition
- toolLoop uses isPreAuth / isPostAuth
- smoke-agent-level-tools.mts
