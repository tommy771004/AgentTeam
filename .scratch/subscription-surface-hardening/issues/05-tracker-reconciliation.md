# 05 — Tracker 對帳：finalization 行為入冊＋INDEX 收口

Status: 可交給代理
Effort: subscription-surface-hardening

## 問題

1. 三個 commit（ce68392／8a6d09c／6419de9）引入的「terminal finalization 不阻塞啟動」行為沒有任何 owning ticket 或 PROGRESS 記錄——active-run-reattachment spec 只規範 reconcileStartup 必須交付 terminal attachments（exactly-once），未記錄啟動路徑的這次語意變更。
2. 本 effort 各票 resolved 後，INDEX.md 需要真實更新。

## 驗收條件

- [ ] 在 active-run-reattachment effort 補一張 owning ticket：記錄啟動不被已恢復 terminal finalization 阻塞的行為、claim lease＋ack gate 如何保住 exactly-once、launcher IPC gate 的位置；Status 可交給代理但 AC 標記為「文件化＋既有 gate 斷言核對」（行為已落地）。
- [ ] 本 effort 01–04 resolved 時，INDEX 列同步改寫（frontier／resolved 欄），維持 INDEX↔issue Status 一致的既有規則。
- [ ] 對照 cli-subscription-pi-loop 的 INDEX 列與 issue Status，若有漂移一併修正（tracker-truth-reconciliation 慣例：以 smoke gate 為唯一證據）。
