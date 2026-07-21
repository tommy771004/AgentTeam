# 01 — llm.ts LlmTransport seam + scripted fake

Status: 可交給代理
Type: task

## 背景

spec.md 決議 5。`chatCompletionWithTools`(`agent/llm.ts:222`)是所有 LLM 呼叫的唯一漏斗,目前無注入點。Fake model 要插在 sanitize → gate **之下**,讓 smoke 連 Outbound Data Gate 一併行使。

## 變更範圍

- `agent/llm.ts`:抽出 `LlmTransport` 型別與預設實作(Electron proxy / browser fetch 的現行選擇邏輯原樣搬入預設 adapter);`export function setLlmTransport(t?: LlmTransport)`,`undefined` 還原預設。`chatCompletionWithTools` 內部改呼叫 `transport(req)`,行為位元級不變。
- 新增測試輔助(建議 `scripts/lib/scriptedModel.mts` 或 `agent/llm.ts` 內 `@internal` export):`scriptedModel(turns)` 依序回放 tool_call / final answer 回應。

## 驗收

- [ ] 新 smoke `scripts/smoke-llm-transport.mts`:`setLlmTransport(scriptedModel([...]))` 後呼叫 `chatCompletionWithTools`,斷言 (a) fake 收到的 req 已經過 sanitize→gate 路徑(protection active 情境)(b) 還原後預設 transport 選擇邏輯不變。
- [ ] `npm run build` 綠(typecheck)。
- [ ] 既有 smoke chain 全綠 — 本 ticket 不得改變任何現行為。

## Comments
