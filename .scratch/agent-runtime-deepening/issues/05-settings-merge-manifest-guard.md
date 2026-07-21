# 05 — Settings merge 完整性守門

**What to build:** 現行 `mergeSettings` 對 14 個物件／陣列型別欄位的手抄特例清單，抽成一個匯出常數（單一來源）。新增一個測試案例，對預設 settings 值逐一檢查：凡值為物件或陣列型別的欄位，斷言其存在於這個特例清單中——忘記幫新欄位加 merge 處理會讓測試紅燈，而不是靜默造成使用者資料遺失。不做型別層的全面重構。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `mergeSettings` 現行 14 個特例欄位名抽成匯出常數。
- [x] 新測試案例（真 import，非掃字串）：對預設 settings 物件的每個 key，若值為物件或陣列，斷言該 key 存在於匯出常數中。
- [x] 既有無關的字串斷言（如既有對 `modelProfiles` 關鍵字的既有斷言）保留不動，不在本 ticket 範圍內。
- [x] 新測試案例併入既有 smoke 檔案，不開新檔。
- [x] `npm run build`、`npm run smoke`、`npx oxlint src` 全綠。

## Comments

### Grilling session 決策摘要（2026-07-20）

- 機制選擇：輕量 smoke 層級完整性檢查，不做 #4 那種型別層大改——這裡的遺漏後果是資料被覆蓋遺失，不是安全繞過，規模對不上大改造的成本。
- 現況查證：79 個欄位中至少 14 個需要客製 merge 語意，目前完全零測試覆蓋（既有唯一相關斷言其實是另一個不相干缺口的 drift-guard）。
- 不開 ADR：可逆、範圍小的內部重構。

## Answer

Implemented 2026-07-20:

- `app/src/agent/settingsMergeKeys.ts` — `SETTINGS_CUSTOM_MERGE_KEYS` (14 keys)
- `settingsStore.mergeSettings` documents + clones all 14 fields
- Completeness test in `smoke-prod-modules.mts` true-imports DEFAULT_LLM_SETTINGS + the key list
