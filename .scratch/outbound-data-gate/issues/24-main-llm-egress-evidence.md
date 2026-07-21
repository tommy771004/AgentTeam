# 24 — Main 於 LLM transport 寫入 egress evidence

**What to build:** 每次 builtin LLM 經 Electron `llm:chat` 真正出站時，由 **main** 寫入 metadata-only Security Evidence（mode、connection、action、profile source），不含 messages/content。補齊票 23 的 LLM 缺口。

**Blocked by:** 19, 23

**Status:** resolved

- [x] `buildLlmEgressEvidenceMeta` 純 metadata
- [x] main `llm:chat` 在 transport 後 append（allow/block）
- [x] renderer 傳 runId / effectiveMode / profileSource（無 content 進 evidence）
- [x] smoke：`smoke-outbound-llm-writeback.mts`

## Answer

- llmEgress.ts meta builder
- main llm:chat + llm.ts pass-through fields
