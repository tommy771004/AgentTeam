# 04 — 醫生卡語言模型檢查

**What to build:** 環境醫生卡新增「語言模型」檢查列，重用 02 的推導結果呈現三態（未啟用／已啟用未通連／可用）與對應補救提示（前往設定／精靈）。讓使用者在按「Start First Task」之前就知道第一個任務會不會真的執行。檢查不觸碰 token、與既有 CLI 檢查同視覺規格。

**Blocked by:** 01, 02

**Status:** resolved

- [x] 醫生卡顯示語言模型三態列與對應補救提示
- [x] 與既有 CLI 檢查同視覺規格、同掃描節奏（不掃 token）
- [x] 元件測試：三態渲染

## Answer

CliDoctorCard 新增「語言模型」檢查磚（renderer 端推導，不依賴 IPC）：三態（未啟用→「前往設定」連至 `/settings?section=llm`／未通連→手動「測試連線」按鈕重用 settingsStore.testConnection／可用）重用 T02 的 `deriveEngineAvailabilityFromSettings`＋`LLM_CHECK_COPY`；測試連線不自動發請求（點擊才測），失敗訊息留在磚內。標頭文案更新為「…並確認語言模型連線；不會讀取或複製 token」。元件測試 3 案（未啟用、測試通過轉可用、失敗停留未通連＋訊息），stub `window.subagents.cli.doctor`。`npm test` 9 passed、`tsc -b` 綠。
