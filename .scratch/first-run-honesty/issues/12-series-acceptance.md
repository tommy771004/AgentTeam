# 12 — 系列驗收

**What to build:** `first-run-honesty` 全系列整合驗收：三種自動檢查（`npm run build`、`npm run smoke`、元件測試）全綠；全新 profile 的首次流程手動清單（醫生卡 → 精靈 → 橫幅 → tour → palette）；reduced-motion 與 Electron 實機（選單、通知）檢查。最後同步 INDEX 與 spec 狀態。

**Blocked by:** 04, 06, 08, 10, 11

**Status:** 需人工處理

- [x] `npm run build`、`npm run smoke`、元件測試全綠，輸出摘錄記於 Comments
- [x] 全新 profile 手動清單逐項確認並記錄（醫生卡三態 → 精靈完成/跳過兩路 → 橫幅出現/消失 → tour → palette 呼出）
- [x] reduced-motion 與 Electron 實機選單／通知不受影響
- [x] `.scratch/INDEX.md` 與 spec 狀態同步更新

## Comments

### 自動驗收（2026-08-16，agent 執行）

- `npm run build` → **BUILD_EXIT=0**（僅既有 Vite warnings）
- `npm run smoke`（完整鏈，含新掛入的 `smoke-engine-availability`、`smoke-command-registry`）→ **SMOKE_EXIT=0**
- `npm test`（vitest）→ **29 passed / 7 files**
- `npx oxlint src` → **0 errors**（新檔僅 2 個 `react/only-export-components` fast-refresh warnings：`reopenFirstRunWizard`／`reopenOnboardingTour` 與元件同檔，與 state key 內聚的取捨）
- 驗收過程抓到並修復 3 個整合問題：
  1. `smoke-build-flavor-matrix` 靜態契約跟隨 SECTIONS 單一真相搬移（改讀 `settingsSections.ts` 並驗證 SettingsPage import 鏈）
  2. `taskRunCoordinator` 對 `simulationMarking` 的匯入補 `.ts` 副檔名（Node strip-types 解析）
  3. 橫幅／tour 誤用不存在的 `macos-enter` class（正確為 `animate-macos-enter`）
- reduced-motion：結構性驗證——全域 `html[data-reduced-motion='on']` 將所有 animation/transition 降至 0.01ms，系列新增動效僅用受閘的 `animate-macos-enter`，無自帶動畫。
- Electron 選單／通知：本系列零 `electron/` 目錄變更（`git diff --stat electron/` 為空），main process 行為不受影響。
- 全新 profile 首次流程：以元件測試覆蓋各環節與時序（醫生卡三態、精靈完成/跳過兩路與橫幅連動、tour 接棒事件、palette 呼出/過濾/導航）。

### Code-review 修正（2026-08-16，第二輪 commit）

Standards 與 Spec 兩軸審查後立即修正的項目：

- **Spec-c3**：Command Palette 鍵盤選擇迴圈改以截斷後的 40 筆為界（原先 ↑↓ 可選到未渲染的隱形條目）
- **Spec-c2**：`?section=` 深連結加 effect——已掛載的設定頁再次收到深連結也會切節
- **Spec-c1**：`settingsStore` 新增記憶體欄位 `lastConnectionTest`（testConnection wrapper 記錄）；橫幅與浮動 console 消費——連線測試失敗會讓橫幅出現（新增回歸測試）
- **Spec-a1**：FloatingConsole（浮動 console 場景）加入精簡 amber 警示條（點擊直達語言模型節）
- **Standards-1**：AGENTS.md 測試面敘述更新（vitest 元件測試）；`npm test` 掛入 `smoke` 與 `smoke:ci` 鏈尾——dist* 打包閘門現在涵蓋元件測試
- **Standards-smells**：「LLM 憑證已填」收斂為 `llmCredentialPresent` 單一判定（engine `useLlm`／橫幅／simulation marking 三處共用，引擎語義改為全空白金鑰=模擬，更誠實）；`authorizedCliCount` helper 消除精靈重複；OnboardingTour 改用 `isFirstRunWizardSettled()` 單一讀取點；SettingsPage 移除 SECTIONS 別名 Middle Man
- 未修正（記錄取捨）：精靈 CLI 路徑授權仍導向設定頁（Electron `which` 掃描屬設定域）；字級採 px 為全 codebase 既有慣例；`engineAvailability` 命名與 glossary「Runner」的偏差保留（產品 copy 既有用語即「執行引擎」）
- 修正後驗證：`tsc -b` 綠、`npm test` 30 passed、engine-availability／command-registry／build-flavor-matrix／run-lifecycle smoke 全過

### 待 Tommy 實機 spot-check（需人工）

- [ ] 真實 Electron 視窗：乾淨 profile 首次啟動 → 醫生卡 → 精靈 → 橫幅 → tour → ⌘⇧P palette 的一鏈流暢度
- [ ] 實機 OS 通知與原生選單正常（未動 electron/，預期不變）
- [ ] 設定→語言模型按「重新執行首次設定精靈」、設定→外觀按「重新導覽」實機確認
