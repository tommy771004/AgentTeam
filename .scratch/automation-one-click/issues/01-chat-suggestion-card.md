# 01 — 對話內自動化建議卡（一鍵建立）

**What to build:** 使用者在對話裡說「每天早上八點幫我整理 inbox」，chat 裡當場出現一張可編輯的排程建議卡——不是一句「請到自動化頁建立」的文字。卡上可以改時間（每天 08:00 → 09:30）、改目標、選執行引擎與 Skills；按「建立」就真的建立好排程，卡片轉為「已啟用」並附下次觸發時間與管理連結。事件意圖（「當 webhook 收到 CI 失敗就…」）走同一張卡。

卡片必須誠實：附一句話說明排程只在 app 開啟或常駐時觸發，並顯示目前佇列狀態，讓人建立前知道系統負載。沒按「建立」之前什麼都不會發生，對話文字也永遠不會直接啟動 Time/Proactive run。

同一個目標已經有啟用中的排程時，不再推卡，只降級成一句輕提示；使用者明確拒絕過的建議，一段時間內不再出現。

建立走與自動化頁完全相同的那條路徑（含間隔下限警告與專案綁定），不另開旁路；建立出來的排程同時出現在自動化頁與待跑佇列。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 對話偵測到排程意圖時，chat 內出現可編輯建議卡（取代原本的純文字提示）
- [x] 事件意圖出現對應的事件規則建議卡
- [x] 卡上可改時間／目標／條件，並可指定執行引擎與 Skills（不是閹割版）
- [x] 「建立」一鍵完成，卡片轉為已啟用狀態並顯示下次觸發時間與管理連結
- [x] 建立走與自動化頁同一條路徑與驗證；建立的排程同時出現在自動化頁與佇列
- [x] 卡片顯示觸發前提說明與目前佇列狀態
- [x] 不按建立就什麼都不會發生；對話文字不會直接啟動 Time/Proactive run
- [x] 同目標已有啟用中排程 → 降級為一句輕提示，不重複推卡
- [x] 拒絕後同目標於冷卻期內不再建議
- [x] 建立來源記錄為對話建議，供日後統計轉換率
- [x] smoke（純邏輯）：意圖→建議 payload、建立 idempotency、活躍抑制、拒絕冷卻、來源標記
- [x] 元件測試：改時間、編輯條件、建立、拒絕、已啟用狀態與連結、佇列顯示

## Answer

對話偵測到自動化意圖時，chat 內改為渲染 `AutomationSuggestionCard`——原本只會回一句「請到自動化頁建立」的純文字，那正是最強能力配最遠入口的斷點。

- **呈現決策**（`agent/automationConsent.ts`，純函式）：`decideSuggestionPresentation` 回 `card` / `notice` / `silent`。順序刻意是「先看拒絕冷卻、再看是否已有等價自動化、最後才推卡」——反過來會讓拒絕過的人又被問一次。冷卻 7 天，只有「拒絕」會靜音，「接受」不會。
- **建立路徑共用**：抽出 `scheduleCreateRequest`／`eventCreateRequest` 純轉換，composer 快速動作與建議卡送出的欄位逐項相同；卡片是另一個殼，不是旁路 API。`ScheduleDraft` 補上 `skillNames`，卡片可指定引擎與 Skills，不是閹割版。
- **誠實性**：卡上明寫「排程只在 app 開啟或常駐時觸發，關閉期間到期的任務下次啟動補跑」，並顯示佇列負載（待跑 n/24，`MAX_QUEUE` 改為 export，不再各處寫死 24）。低於 10 分鐘的間隔給警告但不擋人。
- **狀態持久**：`automationConsentStore` 只記兩件事——拒絕過什麼、哪張卡已建立成功；重開 app 後已建立的卡仍顯示「已啟用」而不是再問一次。
- **bubble 攜帶方式**：`pushBubble` 第五參數由位置參數 `link` 改為具名 `extras: { link, suggestion }`，避免一路往後加位置參數。

**過程中修掉一個真 bug**：`automationSuggestion` 的 `INTERVAL_RE` 讀得懂「每 15 分鐘」，但 `SCHEDULE_SIGNAL_RE` 認不得它——模組內部自相矛盾，使用者說了一句我們明明解析得出來的排程卻收不到建議。已擴充訊號並加測試釘住。

安全模型未放寬，並以契約測試守住：`presentConversationAutomationSuggestion` 區塊不得出現 `runTask`／`dispatchThreadTask`／`startExecution` 且必須回 `status: 'suggested'`；建議卡不得 import 任何執行入口。

驗證：`npm run build` BUILD_EXIT=0、`npm run smoke` SMOKE_EXIT=0、`npm test` 113 passed（新增 12）、`smoke-automation-one-click` 22 項（已掛入 smoke／smoke:ci／新 smoke:automation）、`oxlint` 0 errors。
