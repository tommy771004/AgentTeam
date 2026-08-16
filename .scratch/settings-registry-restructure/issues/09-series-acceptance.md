# 09 — 系列驗收

**What to build:** `settings-registry-restructure` 全系列整合驗收：三種自動檢查（`npm run build`、`npm run smoke`、元件測試）全綠；四群二十節在 advanced 檢視下逐節比對重構前後可見欄位一致；basic／advanced 切換、搜尋命中與錨點深連、匯出匯入遮敏對話框逐項確認。最後同步 `.scratch/INDEX.md` 與 spec 狀態。

**Blocked by:** 02, 05, 06, 07, 08

**Status:** 需人工處理

- [x] `npm run build`、`npm run smoke`、元件測試全綠，輸出摘錄記於 Comments
- [x] 二十節 advanced 檢視可見欄位與重構前逐節比對一致，差異逐項記錄
- [x] basic／advanced 切換與偏好、搜尋命中／高亮／鍵盤跳轉、錨點深連逐項確認
- [x] 匯出匯入遮敏對話框與 policy 可見性規則確認未變
- [x] `.scratch/INDEX.md` 與 spec 狀態同步更新

## Comments

### 自動驗收（2026-08-16，agent 執行）

- `npm run build` → **BUILD_EXIT=0**
- `npm run smoke`（完整鏈）→ **SMOKE_EXIT=0**
- `npm test` → **101 passed / 17 files**（本系列新增 18：AppearancePanel 8、SettingsSearch 10）
- `smoke-settings-registry` → **20 項**；81 個 settings key = 已宣告 73 ＋ 非 UI 8 ＋ 待辦 0
- `npx oxlint src` → **0 errors**，SettingsPage 零警告

### 二十節欄位比對（重構前 e7f097d ↔ 重構後）

以「重構前所有 `SettingsRow`／`SettingsStack` 標題」對照「重構後 panel 標題 ∪ registry label」：**95 個欄位標題，0 個消失**。其中 9 個因為說明文字改由 registry 供給而更名，逐一對照如下（同一個欄位、同一個寫入路徑）：

| 重構前 | 現在（registry label） | 欄位 id |
|---|---|---|
| API 金鑰 | API Key | `llm.apiKey` |
| Always-on 能力包 | 常駐能力包 | `safety.alwaysOnCapabilities` |
| Bot Token（@BotFather） | Bot Token | `gateway.telegramBotToken` |
| Custom tools JSON | 自訂工具 | `safety.customTools` |
| Lifecycle hooks（宣告式規則） | Hook 規則 | `safety.hookRules` |
| Post-state Webhook target（選填） | Post-state Webhook target | `webhook.webhookTarget` |
| 動作應如何核准？ | 核准模式 | `safety.approvalMode` |
| 啟用（Webhook 節） | 啟用 Webhook | `webhook.webhookEnabled` |
| 驗證 Token（留空＝不驗證，不建議） | 驗證 Token | `webhook.webhookToken` |

原本裸稱「啟用」的那一列改為「啟用 Webhook」，是這次唯一在語意上變清楚（而非只是搬家）的地方。

### 契約檢查跟著拆檔一起修

拆檔後有 8 支既有 smoke 因為只讀 `SettingsPage.tsx` 而假性失敗——它們要驗的是「這個 UI 還在不在」，不是「它住在哪一個檔案」。新增共用 `scripts/lib/settingsSurface.mjs`（設定頁 ∪ settings 元件 ∪ panel），`smoke-caps`、`smoke-build-flavor-matrix`、`smoke-outbound-gate`、`smoke-outbound-platform`、`smoke-entitlement`、`smoke-feature-pack`、`smoke-subscription` 全部改用它；`smoke-caps` 的「啟用 Sub Agent」斷言改為驗 registry 宣告＋渲染錨點（標題已由 registry 擁有）。下次再拆檔不會再壞一次。

### 規模

`SettingsPage.tsx` **3898 → 586 行**，另有 18 個 panel 檔；設定頁只剩導覽、`fieldCtx`、深連結跳轉與跨節共用的更新狀態機。

### 待 Tommy 實機 spot-check（需人工）

- [ ] 二十節逐一目視：basic 檢視的欄位選擇是否合理（哪些該升 basic／降 advanced）
- [ ] 搜尋實機：中英文各試幾個詞，確認跳轉、展開進階與高亮的節奏
- [ ] 匯出匯入遮敏對話框實機確認（程式碼零 diff，但值得看一眼）
- [ ] policy-admin build 下 Policy Admin 節仍正確出現
