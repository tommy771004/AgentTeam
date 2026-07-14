# 02 — 讓並行 Loop run 的操作與提問精準綁定

Status: 可交給代理

**What to build:** 讓使用者在 opt-in 並行執行時，看到的執行內容與其停止、繼續、介入、日誌操作永遠是同一個 Loop run。每一個人工提問保留自己的 run 與 thread 身分，並以單一 FIFO 決策介面依序呈現；回答或逾時只影響原本的工作。

**Blocked by:** None — can start immediately.

- [ ] 執行畫面以明確的 `runId` 讀取狀態，且進度、日誌、停止、繼續與人工介入共用該身分。
- [ ] 問題請求帶有來源 run 與 thread 身分，並在單一 FIFO 介面中以 request-specific resolver 處理。
- [ ] 兩個並行 Loop run 同時提問時，回答其中一個或讓其中一個逾時，不會改變另一個 run 的狀態。
- [ ] 維持 ADR-0003 的 capped opt-in concurrency 與單一人工介入 UI，不新增平行 dialog surface。
