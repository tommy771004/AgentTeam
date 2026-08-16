# 09 — 指令註冊表共用化與導航／設定條目

**What to build:** 把 slash 選單的指令來源抽成單一共用註冊表（資料層），slash 選單改為其第一個消費者且行為回歸不變（鍵盤導航、分類、動態合併的 OpenCode 指令照舊）。註冊表擴充「導航」（各頁面）與「設定節錨點」兩類條目；模糊過濾演算法抽成共用純函數。smoke 驗證註冊表完整性。

**Blocked by:** 01

**Status:** resolved

- [x] slash 選單改吃共用註冊表，既有行為回歸一致
- [x] 註冊表含導航與設定節錨點條目（資料齊全）
- [x] smoke：id 唯一、無重複、錨點／路由存在
- [x] 模糊過濾為共用純函數並有單元覆蓋

## Answer

Slash 選單本就吃 registry（確認回歸一致）。新增：`SlashCommand.action` 型別（slash／navigate／settings，缺省=slash 行為不變）；`PAGE_NAV_ENTRIES`（subdesign、design-systems、content-publishing 三個尚無指令的頁面）；設定節抽成單一真相 `src/commands/settingsSections.ts`（SettingsPage 改 import，杜絕漂移；policyAdmin 排除於 palette）；`getAllCommandEntries()`／`filterCommandEntries()`／`fuzzyMatch()`（子字串＋子序列、大小寫不敏感，palette 與未來設定搜尋共用）／`commandEntryPath()`。smoke `smoke-command-registry.mts`（id 唯一、路由存在於 App.tsx、settings 條目↔SETTINGS_SECTIONS 對账、fuzzy 真值、三類條目過濾），掛入 smoke 與 smoke:ci。驗證：smoke 5 groups、`tsc -b` 綠、20 元件測試。
