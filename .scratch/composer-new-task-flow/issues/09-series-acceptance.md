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
