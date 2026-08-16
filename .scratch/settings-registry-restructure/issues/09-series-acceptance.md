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

### Code-review 兩軸修正（2026-08-16，第二輪 commit）

**真 bug**

- **空殼群組卡（兩軸都抓到）**：只有 `AppearancePanel` 自己寫了「群組沒欄位就不畫」的判斷，其餘 panel 沒有，於是基礎檢視下 `safety/門檻`、`safety/LLM 韌性`、`safety/專案 Hooks 信任`、`cli/安全` 會畫出只有標題、裡面空空如也的卡。改成結構性規則 `SettingsGroupFor`（查 `groupHasVisibleFields`），`AppearancePanel` 的自訂判斷一併退役，並加 group 層 smoke 不變式釘住。
- **搜尋跳轉會永久翻掉記住的檢視模式（US12 ↔ US4 衝突）**：`jumpToField` 直接 `setShowAdvanced(true)`，而那個 setter 會寫進偏好——搜尋一次進階欄位，之後就永遠停在進階檢視。改為 `revealAdvancedForJump` 暫時狀態（不落地），使用者自己開進階時清掉。
- **六個空的具名 import**：拆檔後 `import {} from '…'` 仍是 side-effect import，會把 `hermes/mcp`、`outboundGate`、`pluginOAuth`、`opencode/serverClient` 留在設定 chunk 裡。已刪除。

**沒做完的宣稱，補做**

- **US5 深連結只有機制沒有接線**：`settingsPath(section, field)` 加了參數卻沒有任何 production 呼叫端傳第二個參數。已接上三個 CTA（`EngineAvailabilityBanner`、`CliDoctorCard`、`FloatingConsole`）→ `llm.apiKey`，現在是真的落在欄位上而非只到節。
- **條件可見性只是型別**：`visibility: 'policyAdminBuild'` 零個實際欄位使用，原本的 if 樹仍在 `RolesPanel`。已宣告 `roles.policyAdminBuild` 並移除 panel 內的 build flavor 判斷；新增 smoke 斷言「至少一個實際欄位使用它」且「RolesPanel 不得再出現 `SUBAGENTS_BUILD_FLAVOR`」。

**US13 鍵盤補完**：命中清單可捲動且最多 20 筆，原本 ↑↓ 只移動選取、畫面不跟著捲，純鍵盤會選到看不見的項目。加上 `scrollIntoView({ block: 'nearest' })` 與 `aria-activedescendant`／option id。

**衛生**：`smoke-settings-registry` 自己重寫的 surface 掃描改用共用 `settingsSurface.mjs`（原本還漏掉 `components/settings`）；`UpdateState` 型別去重；五個 panel 移除宣告了卻沒用的 `fieldCtx` prop；fail-open 分支的測試改用「真的還沒宣告欄位的節」（原本拿已宣告的 `mcp` 去測，等於沒測到那條分支）。

**文件契約更新**：`AGENTS.md`／`CLAUDE.md` 的「Adding a field requires three edits」已不成立——現在是四處，且 registry 宣告是 fail-closed 強制的。兩份文件同步改寫。

**刻意保留的偏離（記錄而非默默跳過）**

- **US14「語言設定出現在 basic 檢視的外觀節」未實作**：`LlmSettings` 目前沒有任何 `language`／`locale` key，而本 spec 的 Out of Scope 明訂「不加、不砍任何欄位」——兩條要求互相牴觸，無法在本系列內同時滿足。語言欄位屬於系列 6/6 `full-localization`，屆時新增 key 時再依 fail-closed 規則宣告進 `appearance` 節即可（registry 已備妥）。
- **整節皆進階的節在基礎檢視收起**（角色模型、Git）：spec Solution 2 只說「只顯示 basic 欄位」，收整節是我的判斷——因為替代方案就是那張空殼卡。這些節在基礎檢視仍可由搜尋抵達（搜尋不看 tier，跳轉時自動暫時展開）。
- **webhook 啟停 effect 隨畫面搬進 panel**：`App.tsx` 的 `WebhookBootstrap` 才是生命週期擁有者，設定頁那份是重複呼叫；搬移後開機啟停不受影響，但確實是「行為不變」之外的一點差異，故明記。

修正後驗證：`npm run build` **BUILD_EXIT=0**、`npm run smoke` **SMOKE_EXIT=0**、`npm test` **101 passed**、`smoke-settings-registry` **22 項**、`oxlint` 0 errors。
