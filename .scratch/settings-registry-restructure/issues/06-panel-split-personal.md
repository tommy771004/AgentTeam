# 06 — 拆檔批次 A：個人群組 panel

**What to build:** 維護者要改「記憶」節時，只需打開記憶節自己的檔案，而不是捲近四千行的單一設定頁。個人群組各節搬成獨立 panel 元件，由設定頁組裝。使用者這一側完全無感：每個欄位的位置、順序、行為、預設值都與搬移前一模一樣。

**Blocked by:** 03

**Status:** resolved

- [x] 個人群組各節搬成獨立 panel 元件，設定頁只負責組裝
- [x] 每節搬完各跑一次 `npm run build` 與 smoke，不留半綠狀態
- [x] 欄位順序、標籤、預設值、互動行為與搬移前逐項相同
- [x] 節內既有的複雜互動（快捷鍵錄製、記憶清除確認）行為不變

## Answer

個人群組五節全部搬出：`GeneralPanel`、`PersonalizationPanel`、`MemoryPanel`、`DataControlsPanel`、`ShortcutsPanel`（外觀節於 ticket 01 已搬）。SettingsPage 3548 → 3260 行。

搬移原則是「狀態跟著它唯一的使用者走」，不是把一堆 props 往下傳：
- 快捷鍵錄製的 `capturingId` 與整個 keydown effect 進 `ShortcutsPanel`
- 記憶清單／新增草稿與四個 learning store selector 進 `MemoryPanel`
- `dataMsg` 與 metrics helper 進 `DataControlsPanel`
- 訂閱與功能包的九個 store selector 進 `GeneralPanel`

只有真正跨節共用的才留在頁面：`settings`／`set`／`fieldCtx` 以 props 傳入；`updateState` 仍為「安全更新」節所有，功能包需要的只有版本號，因此改傳 `appVersion` 而不是整包狀態。

`openExternalLink` 從 SettingsPage 的私有函式移到 `lib/electronBridge.ts`——panel 反過來 import 頁面是錯的方向。

SettingsPage 清掉 21 行已無人使用的 state／selector、一個 effect 與 17 個 import，`oxlint` 對該檔的 no-unused 警告歸零。

驗證：`npm run build` BUILD_EXIT=0、`npm test` 93 passed、`smoke-settings-registry` 20 項（含「宣告了就要畫得出來」——搬檔後錨點仍全數存在）、`tsc -b` 綠、`oxlint` 0 errors。
