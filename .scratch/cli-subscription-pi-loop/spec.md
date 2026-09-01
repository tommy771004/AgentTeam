# CLI 訂閱 OAuth 餵進 Pi Core loop：訂閱模型成為 builtin 的一等連線

Status: resolved

Source：ADR-0052（accepted，`docs/adr/0052-route-cli-subscription-oauth-into-the-pi-core-loop.md`）與 2026-08-26 的程式碼調查。本規格是該 ADR 的實作。

## Problem Statement

使用者今天選擇 codex / claude 等 CLI provider 時，應用只會直接 spawn 各家自己的 CLI agent——訂閱憑證完全進不了受治理的 builtin 執行路徑。想要 approval、outbound gate、sandbox evidence、Turn Record fidelity 這套 Pi Core 治理的使用者，必須另外購買 API credit；手上有 Codex 或 Claude 訂閱也用不上。

而底層鏈路其實早已就緒：

- `electron/piUserConfig.ts` `syncPiCliOAuth()` 在 production 啟動時把 `~/.codex/auth.json` 匯入為 provider `openai-codex`、把 `~/.claude/.credentials.json` 匯入為 `anthropic`，atomic 寫入（0600）Pi agent dir 的 `auth.json`；`subagentsSource` marker 防止過期 CLI snapshot 覆蓋較新的 Pi-side refresh。
- Vendored Pi 原生支援這兩個 provider 的 OAuth：stored credential 擁有 provider、過期自動 refresh（double-checked locking），且無憑證時不靜默退回 env key。
- `piCoreRuntime.ts` 建立 session 時已經以 `ModelRuntime.create({ authPath })` → `getModel(settings.provider, settings.model)` 解析模型——settings 填入原生 provider id 即可運作。
- Host snapshot 的 `config` 已攜帶同步狀態（`oauthSources` / `oauthImportedProviders` / `oauthSkippedProviders` / `oauthConflicts`），transport 現成。

缺的只有 selection surface：renderer 的 `ApiProviderPreset` 只有四個 OpenAI 相容值（`'aihubmix' | 'openai' | 'openrouter' | 'custom'`），模型列舉靠 `llm.models({ baseUrl, apiKey })` 打 HTTP `/v1/models`，native provider 的模型目錄無從取得，同步狀態沒有消費者。

## Solution

**訂閱連線 = builtin loop 的原生 provider 連線。** 使用者在 Settings 選擇 subscription 連線（provider id 直接為 `openai-codex` / `anthropic`），不需要 baseUrl 與 apiKey；run 仍走 Pi Core Host 的 tool loop、approvals、settlement 與 Turn Record，`executionKind: 'loop'`、DoD 語意、能力矩陣全部不變。

**CLI account authority 是明確的 Host policy。** `followCliOAuthAccount` 預設開啟；同一 CLI source 的 token rotation 與帳號切換會在 startup、Settings refresh/update 與 pre-turn 邊界同步，長駐 Host 不需重啟。使用者可關閉此 policy，關閉後跨帳號切換 fail-closed 為 conflict。非同 source credential、未登入 provider 與 ambient key fallback 仍不會被自動採用。

**模型列舉來自 Host。** 訂閱 provider 的可選模型由 Host 端 ModelRuntime 投影為 bounded list（id、label、context window、reasoning flag），不再打 HTTP `/v1/models`；離線時退回最後快取的 catalog 並如實標示。

**誠實標示。** 這類 run 呈現為「Pi loop + `<vendor>` 訂閱模型」，絕不呈現為 vendor agent run——vendor CLI 自帶的工具鏈、MCP、沙箱在此不存在。外部 CLI runner 路徑原樣保留，仍是取得 vendor 原生行為的方式。

## User Stories

1. As a 訂閱使用者，I want 用 Codex／Claude 訂閱跑受治理的 builtin run, so that 我不必為了 approval 治理再買一份 API credit。
2. As a 使用者，I want Settings 明確顯示每個訂閱 provider 的同步狀態（已匯入／略過／衝突）, so that 我知道連線背後用的是哪份憑證狀態。
3. As a 使用者，I want 衝突或未登入的 provider 顯示為不可用附原因, so that 失敗發生在選擇時而非執行中途。
4. As a 使用者，I want 訂閱 provider 的模型清單直接列出, so that 我不用猜 model id 字串。
5. As a 重度使用者，I want 訂閱 run 與 API-key run 有完全相同的 approval／gate／record 行為, so that 切換連線不改變治理語意。
6. As a 維護者，I want token 永遠不跨 IPC 進 renderer, so that 安全模型不被這次功能破壞。
7. As a 使用者，I want 明確選擇是否跟隨目前 CLI 登入帳號, so that 預設可無重啟接續 CLI rotation，opt-out 時仍保有 account identity 的 fail-closed 邊界。
8. As a 使用者，I want UI 如實區分「Pi loop + 訂閱模型」與「vendor agent」, so that 我對工具行為的期待是正確的。
9. As a 離線使用者，I want Host 無法更新 catalog 時仍能看到最後快取清單並標示過期, so that 選擇面不會整個消失。
10. As a 貢獻者，I want fail-closed 規則集中在單一純投影模組, so that 未來新增 native provider 時複製的是同一份決策而不是散落的 if。

## Implementation Decisions

- **訂閱 catalog 是一個純投影模組（新測試接縫）**。輸入兩項 fixture-able 事實：OAuth 同步狀態（即 snapshot config 既有的 `oauthImportedProviders` / `oauthSkippedProviders` / `oauthConflicts`）與 ModelRuntime 對某 provider 的可用模型列表。輸出 bounded catalog：每個 provider `{ id, availability: 'available' | 'unavailable' | 'conflict', reason?, models: [{ id, label, contextWindow, reasoning }] }`。排序確定（provider id、model id 字典序）、數量有上界。fail-closed 規則只活在這裡：`conflict` → `conflict`；未匯入且無憑證 → `unavailable`；其餘才 `available`。模組不 import Electron、zustand、`window.`，不做時間與隨機呼叫（比照既有投影 smoke 的純度 drift guard）。
- **Host 端持有一個 catalog 用的 ModelRuntime**。`piHostEntry` 啟動時建立一次供列舉（authPath/modelsPath 與 session 路徑同源）；per-session 的建立路徑不變。ModelRuntime 建立失敗不是致命：catalog 對所有訂閱 provider 回 `unavailable` 附原因，fail-closed。
- **Protocol 暴露走 snapshot config 擴充**。訂閱 catalog 併入既有 snapshot 的 `config`（`settings/get` / `state/snapshot` 自然攜帶），不新增 request path；依 ADR-0038 協定版本 v3→v4。**時序硬約束：active-run-reattachment 的 v3 收口併入之後才能動版本**，避免兩個 contract 變更疊在同一版。回應中不得出現 access/refresh token、account id——smoke 以序列化斷言守住。
- **Renderer 映射是最小 diff**。`ApiProviderPreset` 擴充 `'openai-codex' | 'anthropic'`；`PI_SETTINGS_FIELD_BY_KEY` 的 apiProvider→provider 恆等映射使新值自然直通 Host；`validatePiSettingsPatch` 本就接受任意字串、`settings/update` 對空 baseUrl 本就跳過 legacy endpoint persist——Host 端 settings 面零改動。drift guard 斷言訂閱 preset 送出的 patch 不含 `apiKey`/`baseUrl`。
- **SettingsPage 分流**。選到訂閱 provider 時隱藏 baseUrl/apiKey 欄位，改呈現同步狀態與 fail-closed 原因；模型下拉改讀 snapshot catalog 而非 `llm.models`。文案維持繁中混英慣例，並在選擇點標示「Pi loop + 訂閱模型（非 vendor agent）」。
- **testConnection 與健康檢查不變**。Electron production 下本就走 `piHost.health()`；訂閱連線不需要新的探活路徑。
- **安全邊界重申**。token 只存在 utility process 讀得到的 `auth.json`（0600）；renderer 只拿 availability metadata。connector vault 的職責範圍不受影響。

## Testing Decisions

好的測試只驗外部可觀察行為；smoke 必須 import 出貨模組本身，禁止 inline 重實作。

- **Seam 1（主接縫）：訂閱 catalog 純投影**。fixture smoke 餵 sync status × 模型列表，斷言三種 availability 的判定、bounded 與排序確定性、conflict 永不出現在 available、輸出不含任何 credential 形狀欄位。掛進 smoke chain。
- **Seam 2：snapshot 形狀**。protocol 層 smoke 斷言 config 內訂閱 catalog 存在、bounded，且完整序列化結果不含 token 樣式字串。
- **Seam 3：renderer drift guards**。source-text 斷言：(a) 訂閱 preset 值存在於 `ApiProviderPreset`；(b) 送 patch 的映射對訂閱值不夾帶 `baseUrl`/`apiKey`；(c) SettingsPage 對訂閱 provider 渲染同步狀態而非金鑰輸入欄（指向新 owner 的契約檢查風格）。
- **Drift guard：能力矩陣不變**。斷言訂閱 run 與其他 builtin run 共用同一 admission／capability 判定，未被特殊化。
- **基線**：`npm run build`、`npx oxlint src`、完整 `npm run smoke` 全綠。

## Out of Scope

- gemini / opencode / cursor 的憑證匯入（vendored Pi 無對應 native provider；上游先決）。
- 外部 CLI runner 的任何行為變更（含其 harness 缺口——那是 `external-cli-durable-harness` 的範圍）。
- Connector vault 與外掛授權流程。
- 訂閱條款／rate limit 的自動偵測與處理（僅文案揭露）。
- 多帳號並存（一次一帳號；衝突走 fail-closed）。

## Further Notes

- ADR-0052 已記錄被否決的替代方案（proxy vendor binary、只改標籤、提前做其他 CLI 匯入）；本 spec 不重述。
- 票面依賴：01 可立即開工；02 硬性等待 active-run-reattachment v3 收口；03/04 是 SettingsPage 相鄰改動，合併順序需注意；05 的 guard 可在 03 落地後立即寫；06 收口。
- 訂閱條款與限流的揭露文案放 SettingsPage 該 provider 區塊內，一句話即可，不做彈窗。

## Tickets

| # | Ticket | Blocked by |
|---|--------|-----------|
| 01 | [訂閱 catalog 純投影模組 + smoke](issues/01-subscription-catalog-projection.md) | — |
| 02 | [Host snapshot 暴露 catalog + protocol v4](issues/02-host-snapshot-catalog-v4.md) | 01、external: active-run-reattachment v3 收口 |
| 03 | [Renderer 訂閱 preset 面 + settings 映射](issues/03-renderer-subscription-preset.md) | 02 |
| 04 | [模型列舉整合 + fail-closed 狀態呈現](issues/04-model-picker-failclosed.md) | 03 |
| 05 | [誠實標示 drift guards](issues/05-honest-labeling-guards.md) | 03 |
| 06 | [qualification](issues/06-qualification.md) | 01–05 |
| 07 | [CLI OAuth rotation 與帳號跟隨政策](issues/07-cli-oauth-rotation-and-account-following.md) | 06 |
