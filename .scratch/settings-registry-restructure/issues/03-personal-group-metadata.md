# 03 — 個人群組欄位宣告

**What to build:** 一般、個人化、記憶、資料控制、鍵盤快捷鍵五節的每個欄位都宣告好 tier、中英文關鍵字、說明與錨點，於是這幾節在 basic 檢視下只留下一般人會用的開關，進階參數收到「顯示進階」之後，而且全部都搜尋得到。這幾節是新使用者最常來的地方，分層在這裡最有感。

**Blocked by:** 01

**Status:** resolved

- [x] 五節所有欄位完成宣告，並從待辦清單移除
- [x] basic 檢視下這幾節只顯示消費者級開關，進階參數隱藏但值不變
- [x] 每個進階欄位都有一句話說明它調什麼
- [x] 這幾節的欄位都能被中英文關鍵字搜到
- [x] 重構前後 advanced 檢視的可見欄位完全一致

## Answer

一般、個人化、記憶、資料控制四節的 16 個 settings key 完成宣告並自 `PENDING_SETTINGS_KEYS` 移除（68 → 52）；對應的列就地改用 `SettingsField`（tier 過濾即時生效），說明文字改由 registry 供給。

tier 判定：消費者開關留 basic（送出快捷鍵、完成通知／提示音、建議提示、人格、關於你／回覆風格、啟用記憶、預設臨時對話）；工程調參收進 advanced（執行中追問行為、允許並行執行、並行上限、防止睡眠、記憶自動寫入、參考對話歷史、自動封存），每個都補上「調什麼、何時該調回去」的一句話。

`SettingsField` 擴充 stack 版面（標題下方整寬控件），讓「關於你」「希望如何回覆」這類多行輸入也走同一個 registry 路徑；`SettingsRow`／`SettingsStack` 的 title/description 放寬為 ReactNode 以承載「進階」標記。

鍵盤快捷鍵節不含任何 `LlmSettings` key（快捷鍵存於 `shortcutStore`），故無 key 可宣告；該節的可搜尋性由節層錨點提供。

新增 smoke 不變式：每個已宣告的節在 basic 檢視都必須「非空且為 advanced 的子集合」——避免把一整節收光讓人看到空白；工程調參清單釘死為 advanced；「並行／concurrency」中英文都要命中並行上限。

驗證：`smoke-settings-registry` 16 項、`npm run build` BUILD_EXIT=0、`npm test` 93 passed、`tsc -b` 綠。
