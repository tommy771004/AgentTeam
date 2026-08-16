# 02 — 設定搜尋與錨點深連

**What to build:** 使用者在設定頁上方打「併行」或「concurrency」，都能找到並行上限；命中時自動切到該欄位所在的節、捲到它並高亮，不必自己滾。純鍵盤也能完成：在搜尋框用上下鍵在命中項間移動、Enter 直接跳過去。每個欄位有穩定錨點，讓首頁警示橫幅的 CTA、Command Palette、文件連結都能直接連到「語言模型」節的正確欄位。

**Blocked by:** 01

**Status:** resolved

- [x] 搜尋以關鍵字、標籤與說明做模糊匹配，中英文關鍵字都找得到同一個欄位
- [x] 命中自動展開／切換到所屬節，捲到欄位並高亮
- [x] 命中項可用上下鍵移動、Enter 跳轉，全程不需滑鼠
- [x] 進階欄位在 basic 檢視下仍搜尋得到，跳轉時自動顯示（不讓人以為設定不存在）
- [x] 錨點深連可用：外部連結直接開到指定欄位並高亮
- [x] 元件測試涵蓋搜尋過濾、高亮、鍵盤移動與跳轉

## Answer

`SettingsSearch` 掛在設定頁標題下方：以 registry 的 keywords／label／summary／節名做模糊匹配（共用 `fuzzyMatch`），結果列出欄位、一句話說明、所屬節與「進階」標記，最多 20 筆。`role="combobox"` + `role="listbox"/"option"`，↑↓ 循環移動（在最後一項繞回第一項，不會選到未渲染的條目）、Enter 跳轉、Esc 收起、點外面關閉。

跳轉走單一路徑 `jumpToField`：切節 →（命中進階欄位而目前在基礎檢視時）自動打開「顯示進階」→ 捲到錨點並高亮約 2.4 秒。先展開再捲是必要的，否則會捲到一個還沒存在的節點。

深連結：`settingsPath(section, fieldId?)` 擴充為可帶 `&field=`，`?field=` 進來時走同一個 `jumpToField`，所以橫幅 CTA、Command Palette 與文件連結都能直接開到指定欄位並高亮；只帶 `?section=` 的既有行為完全不變。

搜尋刻意不看 tier——進階欄位在基礎檢視下仍搜得到，跳過去時自動展開；否則使用者會以為那個設定不存在。

驗證：`smoke-settings-registry` 13 項（新增深連結路徑）、`SettingsSearch.test.tsx` 10 項（中英文命中、節標示、點擊/鍵盤跳轉、循環、Esc、查無結果、錨點可被 querySelector 選取）、`npm run build` BUILD_EXIT=0、`npm test` 93 passed。
