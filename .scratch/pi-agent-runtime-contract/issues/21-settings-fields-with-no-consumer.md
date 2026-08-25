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

- [x] 每個欄位個別決定：接上行為，或連同 `LlmSettings` 介面、`DEFAULT_LLM_SETTINGS`、Settings UI 一併移除。
- [x] 移除的欄位要處理既有使用者 localStorage 中的殘值（忽略即可，但要確認不會讓 merge 出錯）。
- [x] 接上行為的欄位要有 qualification 證明撥動它會改變可觀察的結果。
- [x] `KNOWN_UNCONSUMED_SETTINGS` 清空並從 `check-pi-contract.mts` 移除該清單與其反向斷言。
- [x] `classificationEndpointUrl` / `classificationAllowPlaintextHttp` 特別確認：名稱暗示會送資料到外部端點，若要接上必須先通過 Outbound Data Gate 的審視，不能繞過。

## Comments

- 發現於 issue 18。同一類錯誤在這個 repo 至少發生三次：`piProduction.ts:38-45` 記載的 `toolsEnabled` 等欄位、issue 18 的 Git 偏好、以及這七個。Guard 6 的目的就是讓它不會有第四次。

## Comments — 完成（2026-08-25）

七個名字，最後是四種不同的事。守衛只會問「有沒有人讀」，答不出「為什麼沒人讀」，所以每一個都得個別查。

### 兩個是守衛自己的偽陽性

`llmRetryMaxAttempts`、`llmCircuitBreakerEnabled` **一直都有消費者**（`agent/llm.ts:393-394`）。Guard 6 第一版把整個 `agent/llm.ts` 當宣告處排除，但那個檔案同時放預設值**和真正的執行邏輯**。守衛已改成只排除 `DEFAULT_LLM_SETTINGS` 字面量。

差一點就照著錯誤的清單把活的設定刪掉。

### 一個不是假開關

`concurrentRunsEnabled` **沒有 UI**，且 `settingsStore.ts:95-98` 寫明它是刻意保留的相容欄位、強制為 true：cross-thread 執行現在是不變式而非選項。接上它等於把已廢除的「全 app 單一執行鎖」裝回去。已移入 `INTENTIONALLY_UNCONSUMED_SETTINGS`，理由寫在守衛裡。

### 一個是功能沒建 → 已建

`ambientSuggestions` 承諾「空對話時顯示 Suggested prompts」。空對話狀態存在，但**從來沒有 suggested prompts 這個東西**。已新增 `SuggestedPrompts`：三個提示，點擊填入輸入框而非直接送出（建議是起點，不是誤觸的指令）。

### 一個是功能已被架構取代 → 已刪

`llmParseEnabled` 承諾「以 LLM 產生貼合目標的步驟與可量測 DoD；失敗時回退啟發式模板」。追下去：`parseUserRequest()` 零呼叫者，`buildParseResult()` 的註解說它是「heuristic 和 LLM parsers」共用而 LLM 那半已隨 legacy engine 移除，整個 `parser.ts` 在正式路徑只剩一條原始碼字串斷言引用它。現在 Pi 路徑的 DoD 是常數 `PI_CORE_SETTLEMENT_DEFINITION_OF_DONE`。

per-objective 的 DoD 產生已經不存在，因為 Pi Core 接管了 settlement。接上它不是接線，是把 Pi 遷移刻意移除的 Parse 步驟裝回去 —— 與 ADR-0045 衝突。**已刪除**（宣告、預設值、UI）。

### 兩個是功能沒做完 → 已補完

`classificationEndpointUrl` / `classificationAllowPlaintextHttp`。`companyClassifier.ts` 模組、smoke、設定頁的「測試連線」按鈕都在，但**真正的出站路徑從未呼叫它** —— 設了端點對實際送出的內容毫無影響。

新增 `outbound/classifierPass.ts`，接進 `createSanitizedWorkspace`（本來就是 async），並由 `taskRunCoordinator` → `outboundBridge` 把設定傳進去。三個性質：

- **分類器只看已 sanitize 過的文字**，看不到原文。把原始內容送給第三方去問「這能不能送」會自我否定。本地 profile 是第一道。
- **只能加，不能減**（`mergeAdditiveExclusions` 的既有設計）。能解除排除的分類器等於一條繞過閘門擴大出站的路。
- **失敗姿態沿用專案自己的法則**（ADR-0047/0051），不另發明：`required` 下分類器答不出來就 **BLOCK**（「我們沒檢查成功」不是「內容安全」的證據，而且部分分類會正好放行那個沒檢查到的檔案）；`optional`/`demo` 降級並明確記錄；`off` 完全不跑。

`smoke-outbound-classifier-pass.mts`（7 tests，已入 `npm run smoke`）涵蓋上述每一條，含未經核准的 plaintext HTTP 在 `required` 下 fail closed。

### 結果

`KNOWN_UNCONSUMED_SETTINGS` **已清空**，守衛註解改為「新增一筆等於一個產品沒兌現的承諾」。
