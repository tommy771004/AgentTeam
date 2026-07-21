# 19 — LLM 出站使用公司 Provider Security Profile

**What to build:** 保護啟用時，builtin LLM 每一輪的 prompt / history / attachments / tool results 必須以 **與該 run Restricted Project View 相同** 的 compiled Provider Security Profile（Company Base + 該 connection 的 Provider Supplemental）淨化與 gate，而不是永遠只用 process 內 builtin baseline。公司草稿啟用後的偵測器與收緊規則必須在真正 egress 生效；`required` 下 profile 不可用則阻擋出站。

**Blocked by:** 16 — Main 擁有 effective Guard Mode；18 — Restricted Project View Root 單一真相源

**Status:** resolved

- [x] 保護啟用時 LLM sanitization 經 `ensurePolicy` 載入 company profile（`prepareLlmEgressMessages`）。
- [x] company-only detector 命中時 payload 不含明文；baseline 對照證明差異。
- [x] `required` + load fail → block egress。
- [x] 僅 effective off 略過；build flavor 不 bypass（既有 gate）。
- [x] 多 round 以 `cacheKey=runId:connectionId` 重用同一 profile。
- [x] smoke：`smoke-outbound-llm-profile.mts`。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bug 2

## Answer

- `outbound/llmEgress.ts`：`resolveLlmEgressProfile` / `prepareLlmEgressMessages` / `loadCompanyProfileViaOutboundIpc`
- `llm.ts` `chatCompletionWithTools`：保護啟用時走 prepare（company IPC → sanitize → gate）
- 無 IPC 時 baseline floor（browser）；required + ensure fail → throw
