# 04 — 代理群組欄位宣告（含條件可見性）

**What to build:** 組態、角色模型、語言模型、CLI 授權、OpenCode、Pi Core 各節欄位完成宣告，工程調參（authLevel、minConfidence、toolSearchThreshold、maxToolRounds、maxToolPayloadKb、並行上限等）明確標為進階並各有一句話說明。Policy Admin 的「只在特定 build 顯示」規則改由 metadata 條件宣告表達，而不是散在畫面裡的 if 判斷；可見性規則本身完全不變，敏感面不因重構而擴大。

**Blocked by:** 01

**Status:** resolved

- [x] 六節所有欄位完成宣告，並從待辦清單移除
- [x] 工程調參一律標為進階，且每個都有一句話說明何時該調、何時該調回去
- [x] Policy 相關設定的可見性規則以 metadata 條件表達，行為與重構前逐項相同
- [x] Pi 的 runtime source of truth 關係不變：registry 只負責呈現與可發現性
- [x] 複雜工作流（CLI 授權矩陣、OpenCode 匯入）內部流程未被拆散，只補宣告

## Answer

組態、語言模型、角色模型、CLI 授權共 36 個 settings key 完成宣告（pending 52 → 16）。工程調參（authLevel、minConfidence、maxIterationsDefault、maxToolPayloadKb、maxToolRounds、toolSearchThreshold、defaultContextWindowTokens、llmRetryMaxAttempts、circuit breaker、FC、漸進披露、CodeMode…）全部標為 advanced，每個都寫「調什麼、調過頭會怎樣」。

`SettingsAnchor` 新增：CLI 授權矩陣、角色模型指派、出站資料閘門這種整段工作流不塞進「標題＋控件」的格子，保留原畫面，只補 registry 的可見性與錨點。

**過程中 ticket 03 加的不變式抓到一個設計問題**：角色模型整節都是進階，basic 檢視下會變成一個點進去空白的節。改為節層收斂——`sectionHasVisibleFields` 為 false 的節直接不進導覽列，且若使用者正停在那一節（從進階切回基礎），自動退回第一個仍看得見的節，不會卡在導覽列上已不存在的節。

**`unattended` 更正歸類**：宣告後才發現設定畫面上根本沒有這個控件（每次 run 由來源決定），改列入 `NON_UI_SETTINGS_KEYS` 並附理由——宣告一個看不到的欄位就是讓搜尋跳到空氣。

新增 smoke 規則「宣告了就要畫得出來」：掃設定頁與所有 panel，任何有 metadata 卻沒有渲染錨點的欄位一律失敗——這條規則就是抓出上面那 13 個缺錨點欄位的東西。

Policy／Pi Core 面板內部未動；`policyAdmin` 節的 build flavor 可見性規則維持原樣（節層過濾），registry 的 `visibility: 'policyAdminBuild'` 已備妥供後續欄位使用。

驗證：`smoke-settings-registry` 18 項、`npm run build` BUILD_EXIT=0、`npm test` 93 passed、`oxlint` 0 errors。
