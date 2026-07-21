# 07 — P5：多 tool_call 並行（Hermes 預設）

**What to build:** 模型同一輪多個 tool_call 時並行執行；單一 call 保持同步。Interactive／HITL／agent-level 工具強制序列。寫回 messages 的 tool 結果維持**原始 tool_call 順序**。不改變 ADR-0003 的 run 級並發產品預設。

**Blocked by:** 06 — P4：Nested／leaf 全強制 Task run

**Status:** resolved

- [x] 多 tool_call 預設並行；單 call 同步
- [x] interactive／HITL／agent-level 強制序列
- [x] tool 結果寫入順序 = 模型 tool_calls 原始順序
- [x] smoke：順序、序列例外、與 invocation 相容
- [x] `tsc`／smoke／oxlint 綠

## Comments

### Parent

- Spec: `.scratch/hermes-aligned-runtime/spec.md` P5 / 決策 20A

## Answer

P5 (2026-07-20):
- Multi tool_calls: parallel via isolated buffers + ordered merge
- Force serial for ask_user / agent-level tools

