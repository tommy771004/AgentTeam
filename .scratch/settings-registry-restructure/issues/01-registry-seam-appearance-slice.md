# 01 — Registry seam 與外觀節垂直切片

**What to build:** 使用者打開設定的「外觀」節時，預設只看到自己會用的開關；按一下「顯示進階」才展開全部。這一票同時鋪好整個系列的地基：每個設定欄位可以宣告自己屬於哪一節、是基礎還是進階、用什麼中英文關鍵字找得到、一句話說明它調什麼、以及一個穩定錨點；並用一支 fail-closed 檢查確保沒有欄位漏宣告——新增設定欄位卻沒宣告 metadata 時，檢查就失敗。外觀節是第一個完整走完這條路的節，其餘節在後續票逐群補齊（過渡期以具理由的待辦清單標記，最後一票清空）。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 欄位 metadata 可宣告：所屬節、basic/advanced、中英文搜尋關鍵字、一句話說明、穩定錨點
- [x] 查詢層提供 tier 過濾與搜尋，搜尋共用 Command Palette 既有的模糊匹配實作（不另造一套）
- [x] fail-closed 檢查：設定型別的每個欄位都必須有 metadata 宣告，或列入具理由的「非 UI 欄位」排除名單；漏宣告即失敗
- [x] 外觀節改為 metadata 驅動渲染，basic 檢視只顯示基礎欄位
- [x] 「顯示進階」切換存在且偏好被記住，重開 app 仍維持
- [x] basic 檢視下被隱藏的欄位值完全不變（切換檢視不影響任何行為）
- [x] `npm run build` 與既有 smoke 全綠

## Answer

新增 `src/settings/fieldRegistry.ts`：`SettingsFieldDef` 宣告 id（＝穩定錨點）／section／group／tier／label／summary／中英文 keywords／`settingsKeys`／`visibility`，並提供查詢層 `fieldsForSection`／`fieldIsVisible`／`sectionHasVisibleFields`／`searchSettingsFields`（搜尋直接用 Command Registry 既有的 `fuzzyMatch`，不另造一套）。

fail-closed 由 `scripts/smoke-settings-registry.mts`（12 項，已掛入 `smoke`／`smoke:ci`／新 `smoke:settings`）保證：對照 `DEFAULT_LLM_SETTINGS` 的 81 個 key，每個必須落在「已宣告」「`NON_UI_SETTINGS_KEYS`（附理由）」「`PENDING_SETTINGS_KEYS`（過渡期）」三者其一且互斥；三份清單不得含不存在的 key。另驗 metadata 完整性（tier／說明／至少各一個中英文關鍵字）、tier 過濾為超集合關係、條件可見性、搜尋不看 tier。

UI：`SettingsField` 包住每一列（控件仍留在各 panel，因為每個都長得不一樣），由 registry 供標籤／說明／錨點／可見性，進階列帶 subtle「進階」字樣；`useSettingsUiStore` 存「顯示進階」偏好（`subagents:settings.ui.v1`）；設定頁標題下新增切換列。外觀節搬成 `components/settings/panels/AppearancePanel.tsx`（92 行 JSX → 3 行），群組在目前檢視下沒有欄位時整張卡不畫。

過程中抓到一個真 bug：錨點 id 原本保留欄位 id 的點號，`#setting-appearance.theme` 在 CSS 選擇器裡會被讀成「id=setting-appearance 且 class=theme」，`querySelector` 永遠找不到——ticket 02 的捲動跳轉會整個失效。已改為點號一律轉連字號，並加測試釘住。

驗證：`npm run build` BUILD_EXIT=0、`smoke-settings-registry` 12 項全過、`npm test` 83 passed（新增 8）、`tsc -b` 綠。SettingsPage 3898 → 3830 行。
