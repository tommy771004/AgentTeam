# 07 — 拆檔批次 B：代理群組 panel

**What to build:** 代理群組各節搬成獨立 panel，包含這個檔案裡最大的兩塊（組態、角色模型）以及 CLI 授權矩陣與 OpenCode 匯入報告。複雜工作流不被拆散——它們整塊搬家，內部流程原封不動。使用者這一側完全無感。

**Blocked by:** 04

**Status:** resolved

- [x] 代理群組各節搬成獨立 panel 元件
- [x] CLI 授權矩陣、OpenCode 匯入報告、角色模型指派整塊搬移，內部流程未被重寫
- [x] Policy Admin 與 Pi Core 既有的專屬面板不動其內部
- [x] 每節搬完各跑一次 `npm run build` 與 smoke
- [x] 欄位順序、標籤、預設值、互動行為與搬移前逐項相同

## Answer

代理群組五節搬出：`SafetyPanel`（543 行，最大）、`RolesPanel`（364）、`CliPanel`（255）、`OpenCodePanel`（179）、`LlmPanel`（203）。SettingsPage 3260 → 1628 行。

複雜工作流整塊搬家、內部流程未重寫：CLI 授權矩陣（含 adapter capability matrix 與逐廠商診斷）、OpenCode 的 config 路徑／專案權限／agents 註冊表／commands→slash、角色模型指派與 Delegate Personas、出站資料閘門的四種 build flavor 分支。Policy Admin 與 Pi Core 仍是既有的獨立元件，未動其內部。

狀態同樣跟著唯一使用者走：連線測試（`testMsg`／`testing`／`onTest`）與模型能力探針進 `LlmPanel`；`cliMsg` 進 `CliPanel`；`ocProviderMsg` 進 `OpenCodePanel`；classifier 測試、persona 草稿與三個角色模型 memo（`roleModelGroups`／`allRoleModelIds`／`suggestedRoleModels`／`setRoleModel`）進 `RolesPanel`；hook 規則草稿與 `toolTuning` 進 `SafetyPanel`。

三個原本是 SettingsPage 私有的東西升級為共用：`StatChip`、`Row`（診斷鍵值列）搬進 `SettingsChrome`，`outboundStatus` 的行內型別抽成具名的 `OutboundStatus`。`RolesPanel` 需要跳到「CLI 授權」節，改以 `onNavigateSection` prop 傳入，而不是讓 panel 反向依賴頁面的 state。

驗證：`npm run build` BUILD_EXIT=0、`npm test` 93 passed、`smoke-settings-registry` 20 項（含「宣告了就要畫得出來」——搬檔後 73 個錨點全數仍在）、`tsc -b` 綠、`oxlint` 0 errors 且 SettingsPage no-unused 警告歸零。
