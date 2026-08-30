# Permanent Usage Ledger

Status: resolved

## Problem Statement

單一 run 的 Context Usage Panel 只能回答目前或歷史 run 的用量，不能回答跨 run 的趨勢、runner／model／project 分布，也不能在 archive retention 後保留最小化的計量紀錄。把全域 Usage page 塞進 `context-usage-panel` 會違反該規格明列的 out-of-scope，並讓 per-run Turn Record projection 與永久彙總 authority 混在一起。

## Solution

建立獨立、最小化的 permanent usage ledger。Task run settlement 是唯一寫入入口；每個 `runId` idempotent upsert 一筆不含 prompt、response、檔案內容或 instruction body 的 measurement。Builtin 優先由 Turn Record 的已量測 usage 建立；External CLI 只能保存 runner 回報的 scalar，且必須標示 `runner-total`。Usage page 只從 ledger 的純 projection 呈現時間區間、tokens、可得成本與 runner／model／project ranking。

## Lifecycle and Authority

1. Run settlement 從 frozen settings 與 settled Agent/Turn Record 建立最小 entry。
2. Electron main 以 atomic replacement 寫入 app-owned ledger；相同 `runId` 覆寫而不重複累加。
3. 舊 Archive 僅執行一次 bounded backfill，並保存 `backfillCompletedAt`。
4. Renderer 透過 bridge 讀取；plain-browser fallback 只提供本機相同 contract，不成為 Electron authority。
5. 清除資料使用同一 bridge，保留完成 backfill marker，避免刪除後重新灌入舊 Archive。
6. 未知 pricing 不顯示推測成本；External CLI process success 不提升為 Checker-backed completion。

## Acceptance

- [x] settlement 只有一個 permanent usage 寫入入口。
- [x] `runId` upsert idempotent，寫檔以 temporary + rename 原子發布。
- [x] Turn Record 與 runner scalar 明確區分 measurement。
- [x] 跨日 buckets、range、breakdown 與 rankings 由純 projection 產生。
- [x] archive backfill 有 durable one-shot marker。
- [x] Usage page 有 desktop／narrow rendered evidence。
- [x] focused smoke 掛入正式 build chain。

## Out of Scope

- provider billing invoice 對帳或自動下載帳單。
- scheduler／publishing 的 quota authority。
- 保存 prompt、response、instruction 或 tool output。
- 以未知價格推算成本，或把 scalar tokens 偽裝成細項。

## Evidence

- `app/scripts/smoke-usage-ledger.mts`
- `app/src/agent/usageLedger.ts`
- `app/src/agent/usageLedgerClient.ts`
- `app/src/pages/UsagePage.tsx`
- `evidence/usage-desktop.png`
- `evidence/usage-narrow.png`
