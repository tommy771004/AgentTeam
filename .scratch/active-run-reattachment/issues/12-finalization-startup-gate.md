# 12 — Finalization 的啟動閘門：已恢復的 terminal 結算不阻塞啟動

Status: 可交給代理
Effort: active-run-reattachment
Origin: commits ce68392／8a6d09c／6419de9（2026-08-26）引入的行為缺少 owning ticket；本票補齊文件與驗收，行為本身已落地並由既有 gates 斷言。

## 行為記錄

1. **Renderer finalization 以 launcher IPC 為閘**（ce68392）：renderer 不得在未取得 launcher 面的 finalization 權限前自行 claim/complete——防止重複交付破壞 exactly-once。
2. **已恢復的 terminal finalization 不阻塞啟動**（8a6d09c）：reconcileStartup 對 terminal attachments 的結算改為非同步、於啟動閘之後處理；啟動路徑不再被一個已結束 run 的收尾工作卡住。exactly-once 由既有的 claim lease（finalize-claim/finalize-complete）＋ack gate 維持：同一 terminal outcome 不會被交付兩次，crash 後恢復時由 lease epoch 裁決所有權。
3. **替換 renderer 的 finalization 同樣過閘**（6419de9）：replacement（重新附著後接手）路徑與首次路徑走同一道閘。

## 與 spec 的關係

原 spec 只規範 reconcileStartup「必須把 terminal attachments 交給 app finalization、只把孤兒標記 interrupted」（exactly-once 語意）。本票記錄的變更是**交付時機**調整（同步阻塞 → 啟動後非同步），交付語意不變。

## 驗收條件（文件化＋既有 gate 核對）

- [x] 行為由三個 commit 落地，且 `smoke-pi-electron-host-e2e.mjs`／`smoke-pi-host-protocol.mts` 等 gate 全綠作為證據。
- [x] 本票即 owning 文件；未來改動啟動路徑或 finalization 閘者必讀。
- [ ] 若後續調整交付語意（而非時機），必須另開新票並更新 ADR 引用——不得在本票內靜默擴權。
