# Settings Registry Restructure：設定分層與搜尋（ADR-0032 落實）

Status: 可交給代理

## Problem Statement

設定頁是近四千行的單一檔案、四群約二十節，把消費者開關（通知、主題、字級）與工程師調參（authLevel、minConfidence、toolSearchThreshold、maxToolRounds、maxToolPayloadKb、並行上限）放在同一個視覺層級。沒有搜尋：找一個開關靠記憶。沒有分層：新使用者在設定裡面對的第一件事是最難的語言模型 API key 與 Base URL。複雜工作流（CLI 授權、MCP 伺服器、OpenCode 合佊、webhook token）與簡單開關混在同一條滾動裡。ADR-0032 已決策「設定由 typed registry 驅動、raw JSON 不是產品介面」，但目前的分層與可發現性尚未落到 registry metadata。

## Solution

把「誰看得到、怎麼被找到」變成 registry 的宣告式 metadata，渲染由 metadata 驅動：

1. 每個設定欄位在 typed registry 宣告：visibility tier（basic／advanced）、搜尋關鍵字（zh-TW + en）、所屬節、說明文字。未宣告者 smoke fail-closed。
2. 設定頁預設 basic 檢視：只顯示 basic 欄位；「顯示進階」切換後全展。
3. 設定搜尋框：以 keywords + 標籤 + 說明做模糊匹配，命中時自動展開所屬節、高亮欄位、支援錨點深連（供警示橫幅 CTA、Command Palette 跳轉）。
4. 單檔拆解：設定頁依節拆為 registry 驅動的 panel 元件；真正複雜的工作流（CLI 授權矩陣、MCP、OpenCode、匯出匯入）保留專屬 panel，但同樣宣告 tier 與搜尋索引。
5. 進階欄位統一視覺語言： subtle「進階」標記與一句話說明，不再靠使用者猜。

## User Stories

1. 作為一般使用者，我想要預設只看到我會用的設定（外觀、通知、個人化、記憶），以便不被工程參數嚇退。
2. 作為進階使用者，我想要一鍵切到「顯示進階」，以便一次看到全部二十節。
3. 作為使用者，我想要搜尋「併行」或「concurrency」都找得到並行上限，以便中英文關鍵字都通。
4. 作為使用者，我想要搜尋命中自動展開並高亮該欄位，以便零滾動找答案。
5. 作為新使用者，我想要從首頁橫幅或 palette 直達「語言模型」節的正確欄位，以便設定 key 不用摸索。
6. 作為使用者，我想要每個進階欄位有一句話說明它調什麼，以便敢調、也知道何時該調回去。
7. 作為使用者，我想要 basic 檢視下被隱藏的欄位值維持不變，以便切換檢視不影響任何行為。
8. 作為管理者，我想要 Policy／Pi Core 相關設定維持其可見性規則（如 policy-admin build 限定），以便重構不擴大敏感面。
9. 作為使用者，我想要匯出匯入的遮敏行為完全不變，以便重構不動資料安全語義。
10. 作為開發者，我想要新增設定欄位時漏宣告 tier／keywords 就讓 smoke 失敗，以便 metadata 永不腐化。
11. 作為開發者，我想要設定節拆成獨立 panel 元件，以便改一節不用碰近四千行單檔。
12. 作為使用者，我想要「顯示進階」偏好被記住，以便回訪時維持我的檢視模式。
13. 作為鍵盤使用者，我想要在設定搜尋框用方向鍵在命中項間移動並 Enter 跳轉，以便全程不碰滑鼠。
14. 作為使用者，我想要語言設定（未來 i18n）出現在 basic 檢視的外觀節，以便切換語言是基本操作。

## Implementation Decisions

- Registry schema 擴充為本 spec 核心：欄位宣告擴充 visibility tier、searchKeywords、section、summary；控件型別（toggle／select／slider／text／password／model-picker 等）沿用 ADR-0032 既有 typed registry 概念，不發明平行機制。
- 渲染層改為 registry 驅動：tier 過濾與搜尋都在 registry 查詢層完成，panel 元件只消費查詢結果；個人／代理／整合／系統四群與節排序維持現狀。
- 搜尋：模糊匹配共用 Command Palette 的過濾實作（`first-run-honesty` spec 引入），單一演算法兩處使用。
- 錨點深連：每欄位有穩定錨點 id，供橫幅 CTA、palette、文件連結使用。
- 與 Pi 的橋接不變（ADR-0025：Pi settings 是 runtime source of truth；Electron UI 呈現 effective 值）；registry 是呈現與可發現性層，不是第二個 source of truth。
- 複雜工作流 panel（CLI 授權、MCP、OpenCode、匯出匯入、角色模型）不拆散其內部流程，只補 tier／索引／錨點。
- 隱藏政策的可見性（policy-admin build flavor）以 registry 條件宣告表達，不做 panel 內 if 樹。
- 單檔拆解以「節為單位、行為不變」為驗收：拆完後 `npm run build` 與既有 smoke 全綠。

## Testing Decisions

- 好的測試只驗外部行為：tier 過濾結果、搜尋命中與錨點、偏好持久化；不測 panel 內部結構。
- smoke（純邏輯）：metadata 完整性——對設定欄位全集合驗證每欄位必有 tier／keywords／section／錨點（fail-closed）；搜尋索引建構函數；tier 過濾函數；policy 條件可見性。
- 元件測試（vitest + testing-library）：搜尋過濾與高亮、basic／advanced 切換與偏好、password 欄位遮蔽、錨點跳轉。
- 手動驗證：四群二十節逐一比對重構前後可見欄位一致（advanced 檢視）、匯出匯入遮敏對話框。
- Prior art：smoke scripts 既有 fail-closed 檢查模式（Electron preload/main contract 檢查）。

## Out of Scope

- 設定「內容」的增減（不加、不砍任何欄位）。
- Policy Admin／Pi Core 專屬面板的內部重構。
- 首次設定精靈（見 `first-run-honesty` spec；本 spec 提供錨點深連供其跳轉）。
- 設定雲同步。
- 多語言（registry 的說明文字先 zh-TW，結構預留 key 化，見 `full-localization` spec）。

## Further Notes

- 建議執行順序：在 `first-run-honesty`（palette 過濾共用）與 `composer-new-task-flow` 之後。
- 與 pi-core-migration 銜接：registry 的欄位來源最终是 Pi adapters 與 Extension Pack manifests（ADR-0032 原文）；過渡期先為現行 flat settings 補齊 metadata，migration 落地時把宣告搬到 pack manifest，查詢層介面不變。
- 拆檔過程建議逐節搬移、每節搬完跑 build + smoke，避免一次大爆炸 diff。
