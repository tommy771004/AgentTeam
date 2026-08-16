# 03 — 系列驗收

**What to build:** `automation-one-click` 全系列整合驗收：三種自動檢查（`npm run build`、`npm run smoke`、元件測試）全綠；手動走一次「對話說出意圖 → 卡片出現 → 改時間 → 建立 → 自動化頁看到 → 實際觸發一次」的端到端；確認安全模型未被放寬。最後同步 `.scratch/INDEX.md` 與 spec 狀態。

**Blocked by:** 01, 02

**Status:** 需人工處理

- [x] `npm run build`、`npm run smoke`、元件測試全綠，輸出摘錄記於 Comments
- [ ] 端到端手動驗證：意圖 → 卡片 → 改時間 → 建立 → 自動化頁同步 → 實際觸發
- [x] 安全模型確認未放寬：無同意不建立、對話文字不直接啟動 Time/Proactive
- [x] `.scratch/INDEX.md` 與 spec 狀態同步更新

## Comments

### 自動驗收（2026-08-16，agent 執行）

- `npm run build` → **BUILD_EXIT=0**
- `npm run smoke`（完整鏈，含新掛入的 `smoke-automation-one-click`）→ **SMOKE_EXIT=0**
- `npm test` → **114 passed / 19 files**（本系列新增 13：AutomationSuggestionCard）
- `smoke-automation-one-click` → **30 項**
- `npx oxlint src` → **0 errors**

### 安全模型確認（未放寬）

以契約測試釘住，而不是靠人記得：
- `presentConversationAutomationSuggestion` 區塊不得出現 `runTask`／`dispatchThreadTask`／`startExecution`，且必須回 `status: 'suggested'`
- 建議卡（`ChatAutomationSuggestion`）不得 import 任何執行入口，只能呼叫 `scheduleCreateRequest`／`eventCreateRequest`
- 背景委派完成通知區塊同樣不得出現執行入口或 `addJob`
- `AutomationSuggestion` 與 `buildRecurringSuggestion` 的回傳值皆不含 `scheduleTrigger`／`eventTrigger`
- `createJob` 只是原樣保存 `createdFrom`；`scheduler.ts` 不得出現任何 `createdFrom === 'chat-suggestion'` 之類的分支——來源永遠不能放寬觸發驗證

Time-based 仍需 claimed ScheduledJob snapshot、Proactive 仍需布林事件證據，兩者皆未更動。

### 待 Tommy 實機 spot-check（需人工）

- [ ] 端到端：對話說「每天早上八點整理 inbox」→ 卡片出現 → 改成 09:30 → 建立 →
      自動化頁看到同一筆 → 等它真的觸發一次
- [ ] 事件路徑：說一句 webhook 意圖 → 卡片 → 建立 → 自動化頁事件分頁可見
- [ ] 重複與拒絕：同一句話再說一次應只得到一句提示；按「不用了」後卡片收起且
      七天內不再出現
- [ ] 背景委派成功後的完成通知確實附上「轉為排程」，且失敗時沒有
