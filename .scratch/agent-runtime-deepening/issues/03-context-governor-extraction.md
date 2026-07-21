# 03 — 上下文治理抽離

**What to build:** 把工具迴圈中段內聯的 token 估算／自動壓縮／checkpoint／memory flush／recall（約 170 行）抽成一個 governor 介面。工廠函式建立 instance，生命週期對齊「每次單一步驟的工具迴圈呼叫」（不是每個 Loop run 一個——現行的每輪使用率門檻狀態本來就是每個步驟重新歸零）。governor 的主要方法在每輪工具迴圈開始前呼叫，回傳（可能經過壓縮處理的）新訊息陣列，取代現行原地清空/重建訊息陣列的寫法。所有真正效果（壓縮呼叫、hook 評估、checkpoint 寫入、記憶 flush/recall、metrics、通知、日誌）皆為注入依賴，包含一個現行直接呼叫、繞過依賴邊界的通知效果。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] governor 工廠函式接受依賴：壓縮、checkpoint 儲存、記憶 flush、記憶 recall、hook 評估、metrics、通知、日誌、context 使用率回報——共九個注入依賴（含補上先前繞過依賴邊界的通知效果）。
- [x] instance 生命週期對齊每次工具迴圈呼叫（每個步驟一個新 instance），使用率門檻狀態不得跨步驟累積。
- [x] 主方法輸入含訊息陣列、輪次、可用工具、設定與執行識別資訊，回傳新訊息陣列（不原地變異）。
- [x] 純數學型輔助函式（token 估算、context window 解析、觸發門檻判斷）維持原樣直接呼叫，不包裝成依賴。
- [x] 壓縮觸發後的六個效果（hook 評估、checkpoint、記憶 flush、訊息替換、記憶 recall、metrics+hook+通知）維持各自獨立錯誤隔離，不合併成單一外層 try/catch。
- [x] checkpoint 收到的是壓縮前的原始訊息陣列（含摘要），不是壓縮後的訊息陣列——順序不可搞反。
- [x] 一個命名怪癖記錄但不修正：現行「壓縮前」事件實際在壓縮動作確定發生之後才觸發。
- [x] 新測試套件真 import governor 工廠函式，涵蓋：固定輪次觸發公式、溢位風險強制壓縮、含圖片附件時跳過壓縮且不呼叫壓縮依賴、壓縮發生時九個效果依序呼叫且 checkpoint 拿到正確的訊息陣列、只有 pruning 沒有壓縮時只替換訊息其餘效果不觸發、使用率門檻日誌只在跨門檻時觸發、六段效果的獨立錯誤隔離迴歸、兩個獨立 instance 的門檻狀態互不影響。
- [x] 既有手抄鏡像測試（regex 掃原始碼字串）全部刪除，改留一條薄的 wiring 確認（呼叫端確實呼叫了 governor 的主方法）。
- [x] `npm run build`、`npm run smoke`、`npx oxlint src` 全綠；人工核對新模組與被取代內聯邏輯的九個效果呼叫順序逐一對齊。

## Comments

### Grilling session 決策摘要（2026-07-20）

- 介面形狀：工廠注入（deps），非效果即資料（此處效果是序列中段真正呼叫 LLM／I/O，效果即資料會逼出過度工程的 generator 協議）。
- 對標 Claude Code 桌面版公開文件驗證方向：持久化狀態該用「重新注入」而非原地變異；compaction／checkpoint／memory 保持三個獨立關注點，由同一個 orchestration 呼叫，不合併成一個大函式。
- 修正過的關鍵假設：instance 生命週期原先誤判為「每個 Loop run 一個」，查證後確認現行 `lastUsageBucket` 只活在單次工具迴圈呼叫（= 每個步驟）裡，instance 必須對齊這個既有重置語意。
- 不開 ADR：可逆內部重構。

## Answer

Implemented 2026-07-20:

- `app/src/agent/tools/contextGovernor.ts` — `createContextGovernor` + injected deps
- `toolLoop.ts` wires one governor per tool-loop step via `beforeRound`
- `scripts/smoke-context-governor.mts` — 7 true-import tests
