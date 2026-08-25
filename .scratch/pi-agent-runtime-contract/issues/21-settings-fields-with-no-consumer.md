# 21 — 七個沒有消費者的 Settings 欄位

**What to build:** `KNOWN_UNCONSUMED_SETTINGS` 清空。每個欄位要嘛接上行為，要嘛從 Settings 移除 —— 使用者能撥動、卻什麼都不改變的開關，是產品沒有兌現的承諾。

**Blocked by:** 無。

**Status:** 可交給代理

## 問題

issue 18 新增的 Guard 6（`scripts/check-pi-contract.mts`）掃過 `DEFAULT_LLM_SETTINGS`，找出在宣告、預設值、Settings UI 與 settingsStore 以外**沒有任何消費者**的欄位：

- `llmRetryMaxAttempts`
- `llmCircuitBreakerEnabled`
- `llmParseEnabled`
- `classificationEndpointUrl`
- `classificationAllowPlaintextHttp`
- `concurrentRunsEnabled`
- `ambientSuggestions`

七個皆經逐一確認為零消費者。它們目前列在 `KNOWN_UNCONSUMED_SETTINGS`，**是列出、不是豁免**：守衛對任何新漂移立即生效，這份清單記錄的是既有欠債。

## 驗收條件

- [ ] 每個欄位個別決定：接上行為，或連同 `LlmSettings` 介面、`DEFAULT_LLM_SETTINGS`、Settings UI 一併移除。
- [ ] 移除的欄位要處理既有使用者 localStorage 中的殘值（忽略即可，但要確認不會讓 merge 出錯）。
- [ ] 接上行為的欄位要有 qualification 證明撥動它會改變可觀察的結果。
- [ ] `KNOWN_UNCONSUMED_SETTINGS` 清空並從 `check-pi-contract.mts` 移除該清單與其反向斷言。
- [ ] `classificationEndpointUrl` / `classificationAllowPlaintextHttp` 特別確認：名稱暗示會送資料到外部端點，若要接上必須先通過 Outbound Data Gate 的審視，不能繞過。

## Comments

- 發現於 issue 18。同一類錯誤在這個 repo 至少發生三次：`piProduction.ts:38-45` 記載的 `toolsEnabled` 等欄位、issue 18 的 Git 偏好、以及這七個。Guard 6 的目的就是讓它不會有第四次。
