# 08 — 拆檔批次 C：整合與系統 panel

**What to build:** 其餘各節（Git、Webhook、閘道、MCP、OAuth、更新、匯出匯入）搬成獨立 panel，設定頁收斂成一層薄薄的組裝層：讀查詢層、依 tier 與搜尋結果決定顯示哪些節與欄位、把節交給對應 panel。到這裡「改一節不用碰大檔」對二十節全部成立。

**Blocked by:** 05

**Status:** resolved

- [x] 其餘各節搬成獨立 panel 元件
- [x] 設定頁本身收斂為組裝層，不再包含任何單一節的欄位實作
- [x] MCP 伺服器與匯出匯入的既有流程（含遮敏對話框）行為不變
- [x] 每節搬完各跑一次 `npm run build` 與 smoke
- [x] 欄位順序、標籤、預設值、互動行為與搬移前逐項相同

## Answer

其餘七節搬出：`UpdatesPanel`、`GitPanel`、`WebhookPanel`、`GatewayPanel`、`McpPanel`（496 行，第二大）、`OAuthPanel`、`BundlePanel`。**SettingsPage 1628 → 586 行；起點是 3898 行，共 18 個 panel 檔。**

設定頁現在真的是組裝層：讀 registry 決定導覽列有哪些節、算 `fieldCtx`（tier + policy build + 高亮）、處理 `?section=`／`?field=` 深連結與跳轉、擁有跨節共用的更新狀態機，其餘一律交給對應 panel。單一節的欄位實作已完全不在這個檔案裡。

兩個 effect 跟著它們的畫面走：
- gateway 狀態刷新（註解本來就寫明「start/stop 在 App.tsx」）→ `GatewayPanel`
- webhook 啟停 → `WebhookPanel`。查證過 `App.tsx` 的 `WebhookBootstrap` 才是 webhook 生命週期的擁有者（開 app 就依設定啟停），設定頁那份是重複呼叫、真正作用只是顯示狀態字串；搬進 panel 後重複呼叫也一併消失，開機啟停行為不受影響。

匯出匯入的遮敏對話框與流程一字未動（`settingsExport.ts`／`settingsStore.ts` 全系列零 diff）；MCP 的伺服器清單、探測、工具封裝審核與 `{{secret:}}` 憑證欄位整塊搬移。

驗證：`npm run build` BUILD_EXIT=0、`npm test` 93 passed、`smoke-settings-registry` 20 項（73 個錨點搬檔後全數仍在）、`tsc -b` 綠、`oxlint` 0 errors 且 SettingsPage 零警告。
