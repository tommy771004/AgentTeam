# 04 — Usage 輪詢契約硬化＋右欄隔離補完

Status: resolved
Effort: subscription-surface-hardening

## 問題

1. 晚到的 poll 頁經 appendRecordEntries 寫入時會設 `active: true`／清 `draftText`——一個已結束 run 的 presentation 若尚未落 terminal digest，可能被翻回進行中。
2. R1 的「其他區塊不因用量重繪」目前只在主 feed 成立；右欄仍以頂層 hook 整面訂閱。

## 驗收條件

- [x] refresher 寫回前複查 activeRunIds（activeRunIds）；不在則整頁丟棄不寫。
- [x] 防復發 guard 掛進 smoke-context-usage-projection（activeRunIds 斷言＋no-op identity＋cleanup/dedupe/feature-detect）。
- [x] 右欄 head 用 ContextUsageChip、body 為 memo RunContextBody（僅展開時計算投影）。
- [x] 既有註解保留，未改道新 IPC。
- [x] 三項保證由 smoke-context-usage-projection 斷言釘住。
