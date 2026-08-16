# 02 — 背景委派完成後一鍵轉為排程

**What to build:** 一次性的背景委派任務成功之後，完成通知上多一個「轉為排程」動作：按下去就用同一個目標開出建議卡（或直接建立），把一次性的成功常態化。使用者不必回想剛才那個任務的措辭、也不必重打一次。

**Blocked by:** 01

**Status:** resolved

> ~~⚠️ 此票會動到 `RunSummaryCard`…~~ **開工後證實不成立**：背景委派的完成通知是 `injectBackgroundResult` 推的系統訊息，不在 `RunSummaryCard`。本票零檔案重疊。

- [x] 成功的背景委派任務在完成處出現「轉為排程」動作
- [x] 動作沿用票 01 的建議卡與建立路徑，不另寫一條
- [x] 失敗或未完成的任務不出現此動作
- [x] 元件測試涵蓋出現條件與建立路徑

## Answer

背景委派成功後，完成通知那則系統訊息直接附上「轉為排程」的建議卡——沿用票 01 的同一張卡與同一條建立路徑，使用者不必回想剛才那句措辭。

**原本假設的檔案衝突並不存在**：我在拆票時猜這會動到 `RunSummaryCard`，實際上完成通知是 `agent/hermes/backgroundJobs.ts` 的 `injectBackgroundResult` 推的系統 bubble。整票零檔案與並行 session 重疊。

新增 `buildRecurringSuggestion(objective, reason)`：與 `detectAutomationSuggestion` 的差別是後者從對話文字**猜**有沒有排程意圖，而這裡是使用者已經把事情做成功了、我們問要不要常態化——成功任務的目標文字裡本來就不會有 cron 字樣（smoke 以 `detectAutomationSuggestion(goal) === null` 把這個前提釘住），所以不能靠偵測。

規則：
- 只有 `job.ok` 才提議常態化；失敗的任務不該被建議重複執行
- 仍然是提案：回傳值不含任何觸發證據，完成通知區塊不得出現 `runTask`／`dispatchThreadTask`／`addJob`（smoke 斷言）
- 抑制與冷卻沿用票 01 的同一套判定，不是另一條路——已有等價啟用中排程只提示、拒絕過則靜音

驗證：`npm run build` BUILD_EXIT=0、`npm run smoke` SMOKE_EXIT=0、`npm test` 114 passed、`smoke-automation-one-click` 30 項、`oxlint` 0 errors。
