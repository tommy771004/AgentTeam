# 02 — 引擎可用性推導純函數

**What to build:** 一個無副作用的推導模組：輸入語言模型設定（是否啟用、憑證與連線結果）與 CLI provider 授權狀態，輸出型別化的判定結果，同時滿足兩個消費者——警示橫幅的顯示/隱藏判定、醫生卡的三態（未啟用／已啟用未通連／可用）。狀態對應的 zh-TW（與未來 en）文案 key 一併定義。smoke 對輸入組合做全枚舉。

**Blocked by:** None — can start immediately（可與 01 並行）。

**Status:** resolved

- [x] 純函數無副作用，輸入輸出型別化（橫幅判定 + 醫生卡三態由同一結果推導）
- [x] smoke 覆蓋組合全枚舉：語言模型 off／on+憑證缺失／on+通連，× 有／無任一已授權 CLI
- [x] 不讀 store、不觸 IPC——只在消費端接資料

## Answer

`src/agent/engineAvailability.ts`：`deriveEngineAvailability`（36 組合全枚舉）＋`deriveEngineAvailabilityFromSettings` 投影＋文案 key（LLM_CHECK_COPY 三態／ENGINE_BANNER_COPY）。關鍵語義決策：橫幅可見性對齊引擎 `useLlm()`（enabled＋apiKey 即跑真實 LLM），「已啟用+金鑰+尚未測試連線」不顯示橫幅，只有連線測試失敗才排除；醫生卡三態（disabled/unverified/ok）獨立呈現驗證狀態。smoke `scripts/smoke-engine-availability.mts` 已掛入 `smoke` 與 `smoke:ci` 鏈；`npx tsc -b` 綠。
