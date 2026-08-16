# First-Run Honesty：首次體驗與誠實性

Status: 可交給代理

## Problem Statement

新使用者在未設定任何語言模型或 CLI 授權的情況下，app 仍會以 heuristic/simulation 策略「完成」任務，而且只在 log 留下一行紀錄——composer 與首頁沒有任何警示。使用者可能跑完一個假任務，還以為真的發生了什麼。首次設定的入口（語言模型的 API key）深藏在近二十節的設定頁裡；首頁的環境醫生卡只檢查本機 CLI（Git/Codex/Claude/OpenCode），不檢查語言模型連線，所以「Start First Task」按下去可能仍是 simulation。另外，功能面（四種 Loop Pattern、多種執行引擎、Approval Mode）大到只能靠 tooltip 與文件頁自學，沒有導覽；Slash 指令超過四十個，沒有全域搜尋入口。

相對於 ChatGPT Desktop「登入即用」，本產品的第一分鐘決定了使用者會不會留下。

## Solution

把「絕不靜默假裝完成」變成產品原則：

1. 語言模型未啟用（且無任何已授權 CLI）時，composer 上方常駐明顯警示橫幅，附「前往設定」CTA；設定完成後橫幅即時消失。
2. 首次啟動精靈：引導選擇路徑（內建 LLM API key 或授權外部 CLI）→ 填寫/授權 → 測試連線 → 完成；可跳過，但跳過後橫幅仍在。
3. 環境醫生卡納入語言模型連線檢查（不限 CLI），讓「開始第一個任務」之前就知道會不會真的執行。
4. Simulation run 在 transcript 中明確標示（系統訊息與 RunSummaryCard 均帶標記）。
5. Onboarding tour：spotlight 式一次性導覽（可從設定重看），介紹 Loop Pattern 差異、執行引擎選擇、Approval Mode 三段差異。
6. 全域 Command Palette（與既有 slash 選單共用指令註冊表）：涵蓋動作、頁面導覽、設定節，鍵盤可達。

## User Stories

1. 作為新使用者，我想要在未設定任何模型來源時看到明顯警示橫幅，以便不會誤把 simulation 結果當成真實執行。
2. 作為新使用者，我想要一鍵從警示橫幅跳到正確的設定節，以便不用在近二十節設定裡尋找 API key 欄位。
3. 作為新使用者，我想要首次啟動被精靈引導完成語言模型或 CLI 授權，以便三分鐘內跑出第一個真實任務。
4. 作為只想用外部 CLI 的使用者，我想要精靈提供「授權 Codex/Claude CLI」這條路，以便不被迫申請 API key。
5. 作為新使用者，我想要環境醫生卡告訴我語言模型連線是否可用，以便預測「Start First Task」會不會真的執行。
6. 作為使用者，我想要 simulation run 在 transcript 與摘要卡上被明確標示，以便事後審視時不會與真實 run 混淆。
7. 作為使用者，我想要警示橫幅在設定完成的當下消失，以便立即確認修復生效。
8. 作為跳過精靈的使用者，我想要之後仍能從橫幅或設定重新開啟精靈，以便改變心意時不必自己找路。
9. 作為新使用者，我想要 onboarding tour 用一段話講清楚四種 Loop Pattern 的差異，以便選 Turn 或 Goal 時不是在猜。
10. 作為新使用者，我想要 tour 說明 Approval Mode 三段（要求核准／代我核准／完整存取權）的風險差異，以便放心選擇。
11. 作為新使用者，我想要 tour 介紹執行引擎（內建 vs 外部 CLI）的能力差異，以便理解「外部 CLI 執行」標章的含義。
12. 作為進階使用者，我想要全域 Command Palette 以快速鍵呼出，以便不用記住四十多個 slash 指令。
13. 作為使用者，我想要 palette 搜尋涵蓋動作、頁面導覽與設定節，以便鍵盤完成絕大多數操作。
14. 作為回訪使用者，我想要完成精靈與 tour 後不再被打擾，以便日常使用零摩擦。
15. 作為重視無障礙的使用者，我想要 tour 與橫幅尊重 reduced-motion 與字級設定，以便不影響可讀性與舒適度。
16. 作為多視窗使用者，我想要 palette 與橫幅在任何頁面都可用（含浮動 console 場景），以便狀態一致。

## Implementation Decisions

- 橫幅顯示狀態由純邏輯推導：「語言模型已啟用且通連」或「任一 CLI provider 已授權」任一成立即隱藏；此函數供 UI 訂閱，不做新的狀態 store。
- 精靈是獨立 overlay flow，不佔用路由；步驟狀態機：選路徑 → 憑證 → 測試連線 → 完成；「測試連線」重用既有設定頁的連線測試能力，不重寫。
- 醫生卡檢查項擴充一個「語言模型」項（未啟用／已啟用未通連／可用三態），與既有 CLI 檢查同視覺規格。
- Simulation 標示：run 進入 simulation 策略時，於 transcript 投射一條系統訊息，並在 run 摘要卡加「模擬執行」章；不改 Loop Runner 語義（ADR-0026：判定仍在 Orchestration/Loop Runner 層，UI 只呈現）。
- Tour 採 spotlight 覆蓋層，完成狀態存 UI 偏好；設定「外觀」節提供「重新導覽」入口。
- Command Palette 與 slash 選單共用同一個指令註冊表（單一來源、兩個殼）：palette 額外索引頁面導覽與設定節錨點，共用模糊過濾實作。
- 快速鍵配置納入既有可重設快捷鍵機制；palette 預設 chord 不與現有全域快捷鍵衝突。
- 本 spec 引入 vitest + @testing-library/react 作為 UI 元件測試 seam（所有後續 spec 共用）；smoke scripts 仍是純邏輯 seam，`npm run build` 仍是 typecheck 閘門。
- 遵循 ADR-0026：不新增執行路徑；遵循 ADR-0025：連線測試走 Pi settings/runtime 的實際路徑，不做旁路探測。

## Testing Decisions

- 好的測試只驗外部行為：橫幅「何時出現/消失」、精靈步驟推進、palette 過濾結果，不測內部狀態欄位。
- smoke（純邏輯）：橫幅狀態推導函數（enabled/key/authorized 組合的全枚舉）；指令註冊表完整性（palette 索引涵蓋所有註冊項與設定節錨點）；simulation 標示的投射條件。
- 元件測試（vitest + testing-library）：橫幅條件渲染與 CTA 導向、精靈步驟流與跳過、palette 搜尋過濾與鍵盤導覽、醫生卡三態顯示。
- 手動驗證：tour 動畫與 reduced-motion、Electron 實機選單與通知不受影響。
- Prior art：smoke scripts 既有模式（scheduler 數學、event matching、capability 純邏輯）。

## Out of Scope

- 設定頁本身的分層與搜尋（見 `settings-registry-restructure` spec）。
- Composer 進階選項折疊與 DoD 建立時輸入（見 `composer-new-task-flow` spec）。
- 多語言（橫幅/精靈字串先以現行 zh-TW hardcode，待 `full-localization` spec 抽換）。
- 語言模型供應商市集或推薦。

## Further Notes

- 本 spec 是六份系列的第一份，建議執行順序：01 → 02 → 03 → 04 → 05 → 06（i18n 最後，避免字串重抽）。
- 與 pi-core-migration 銜接：連線測試與「模型可用」判斷應落在 Pi Host 的模型測試路徑上，Electron UI 只消費結果；若 migration 尚未走到該里程碑，先以現行 renderer 判斷實作並留下明確 seam。
- 引入測試 runner 時須確認 `dist*` 的 smoke 閘門不受影響（vitest 不掛進打包鏈）。
