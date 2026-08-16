# 09 — 系列驗收

**What to build:** `composer-new-task-flow` 全系列整合驗收：三種自動檢查（`npm run build`、`npm run smoke`、元件測試）全綠；一份手動清單走過新使用者與進階使用者兩條路徑（只用輸入框送出 → 展開進階改引擎 → 排程／事件 tile 建立 → Goal 任務編輯 DoD → 失敗後調參重跑 → rewind 確認 → 舊連結 redirect）；最後同步 `.scratch/INDEX.md` 與 spec 狀態。

**Blocked by:** 02, 04, 05, 06, 08

**Status:** 需人工處理

- [x] `npm run build`、`npm run smoke`、元件測試全綠，輸出摘錄記於 Comments
- [ ] 手動清單逐項確認並記錄（基礎路徑／進階路徑／排程＋事件建立／DoD 編輯／調參重跑／rewind／redirect）
- [x] 鍵盤可達性檢查：折疊區、Build/Plan Tab、DoD 卡、確認面板
- [x] `.scratch/INDEX.md` 與 spec 狀態同步更新

## Comments

### 自動驗收（2026-08-16，agent 執行）

- `npm run build` → **BUILD_EXIT=0**（僅既有 Vite `INEFFECTIVE_DYNAMIC_IMPORT` warnings）
- `npm run smoke`（完整鏈，含新掛入的 `smoke-composer-new-task`）→ **SMOKE_EXIT=0**
- `npm test`（vitest）→ **74 passed / 13 files**（本系列新增 40 個：ConfirmSheet 7、ChatBubble 4、ComposerAdvanced 6、AutomationCreateSheet 10、DodPreviewCard 11、RetryWithOverrides 6）
- `npx oxlint src` → **0 errors**，新檔零 warning
- 新增 `scripts/smoke-composer-new-task.mts`（21 項純邏輯 + 契約）：排程/事件草稿組裝與空輸入回退、排程 runner 白名單、定時/事件非可釘選 loop、DoD 預覽與 ingress 回退、DoD 只覆寫文本且排在 LLM 精煉之後、retry 參數白名單/夾緊/資格、redirect 對照表、死檔清除、rewind 無原生 confirm。已掛入 `smoke`、`smoke:ci`、`smoke:composer`。

### 鍵盤可達性

- 折疊區觸發器與內部所有 Choice 皆有 `focus-visible` outline；`aria-expanded` / `aria-controls` / `aria-pressed` 齊備
- 兩張 sheet 共用 `useDialogKeys`：Esc 關閉 + Tab 在面板內循環（原本 `AutomationCreateSheet` 沒有焦點收束，Tab 會走到背後的控制）
- `ConfirmSheet` 開啟時焦點落在確認鍵、關閉時交還原本元素
- `Icon` 新增 `aria-hidden` 直通並套用於新元件——ligature 字型的字面本來會被讀成「track_changes 目標」
- Build/Plan 的 Tab（空輸入）快捷未更動

### 待 Tommy 實機 spot-check（需人工）

- [ ] 一般路徑：只用輸入框送出，確認基礎列夠乾淨、進階收合預設正確
- [ ] 進階路徑：展開改引擎/深度 → 關掉 app 再開，偏好仍在
- [ ] 排程與事件 tile：預填 → 建立 → 自動化頁看到同一筆 → 停用
- [ ] Goal 任務：DoD 卡出現、編輯後送出，run 的驗收標準採用編輯後的文字
- [ ] 失敗 run：「調整參數重跑」實際跑起來、回到同一對話
- [ ] rewind 確認面板與舊連結 `/failed` redirect

### Code-review 修正（2026-08-16，第二輪 commit）

兩軸審查後立即修正的項目：

- **Spec-c1（真 bug）**：composer 仍可能送出 Time-based/Proactive run——排程／事件跑出來的 thread 會被 `bindRunThread` 綁上該 loopType，舊版釘選過的對話也是；直接當釘選送出會撞「trigger 無效」fail-closed，正是本 spec 要消滅的死路。新增 `composerSendableLoopType()` 在送出路徑收斂為 Goal/Turn/null（進階區摘要一併使用，UI 不再誤報釘選）。
- **Standards-5（真 bug）**：`dodSkipped` 在送出時沒被讀到——編輯 DoD 後按「略過」仍會送出那段編輯。改為送出時直接使用畫面上那張卡的 `dodPreview`（略過時為 null），順帶消除送出時重跑一次 `parseUserRequest` 的浪費與 attachment-only 路徑的預覽不一致。
- **Spec-a2（誠實性）**：`RuntimeOverrides.timeoutMs` 在整個 run 路徑上**沒有任何消費者**（engine/loop 都不讀，退役的失敗頁那顆同樣是空的）。與其保留一顆按了沒作用的控制，已從 retry popover 與白名單移除，理由寫進 `retryOverrides.ts`。**這是對 spec US11「逾時」的刻意偏離**——要真的支援需在 engine 加 run-level watchdog（與 HITL 等待、工具呼叫、佇列互動），屬另一件工作。
- **Spec-a1**：`ThreadBubble` 新增選用 `link`，系統訊息現在附「前往自動化頁調整或停用」直達連結（排程→`#/automation`、事件→`#/automation?tab=events`），補上 spec 要求的「job 連結」。
- **Standards-4**：`jobRunnerFor(runner: string)` 收緊為 `ThreadRunner`，呼叫端打錯字不再能編譯過。
- **Testing**：最脆的 source-regex 斷言改寫——不再比對整段程式碼形狀，只驗「套用點排在 LLM 精煉之後」與「套用區塊只碰 definitionOfDone，不改 loopType/steps/maxIterations」。
- 未修正（記錄取捨）：`composerLayering`／`composerAutomationDraft` 的 icon/label 屬呈現資料卻放在 `agent/` 層——放這裡是為了讓 smoke 不必載入 JSX 就能驗契約；modal 外殼 class 在三個元件間重複（鍵盤契約已抽成 `useDialogKeys`，視覺外殼未抽）；`AutomationCreateSheet` 的 `isSchedule ? :` 分支仍多；LLM 於 auto 模式改判 Turn-based 時使用者 DoD 會被丟棄（僅 WARN log）——spec 明訂「使用者 DoD 不影響 loop 判定」，故維持記錄而非改判。

修正後驗證：`npm run build` **BUILD_EXIT=0**、`npm run smoke` **SMOKE_EXIT=0**（smoke-composer-new-task 22 項）、`npm test` **75 passed**、`npx oxlint src` 0 errors。
