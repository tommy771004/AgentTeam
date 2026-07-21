# 12 — 背景增量上傳證據與管理裝置生命週期

**What to build:** 將本機已持久化的 Security Evidence Records 按 workspace、Managed Device ID 與 ISO week 在背景增量上傳，使用 idempotent sequence acknowledgement 維持服務不中斷；同時提供 retention、裝置撤銷/更換與遺失 pending evidence 的可驗證生命週期。

**Blocked by:** 04 — 建立本機可驗證 Security Evidence Ledger；11 — 建立 Managed Device Enrollment 與 HTTP Secure Envelope

**Status:** resolved

- [x] evidence destination 支援 `local|workspace|both`；required Workspace 預設 both，local source 預設 local。
- [x] outbound decision 先 durable local append，才可排入背景 upload。
- [x] uploader 使用小型 ordered batch、event ID/sequence idempotency 與 highest contiguous acknowledgement。
- [x] retry、重啟或重複 acknowledgement 不會造成 duplicate central record、sequence skip 或 chain reorder。
- [x] upload failure 保留 queue 與可見狀態，不阻擋其他符合 policy 的工作。
- [x] central storage 依 workspace ID、device ID、ISO week 分區，並能用該裝置歷史 key 驗證 chain。
- [x] `retentionWeeks=0` 表示永久保留；正常 retention 不刪除尚未 acknowledged 的 records。
- [x] weekly terminal MAC/checkpoint 經 ack 後才允許 eligible local deletion，retention checkpoint 可區分政策刪除與 tamper truncation。
- [x] 電腦更換建立新 device ID/key、撤銷或退休舊裝置，並寫入 linked device-replaced events。
- [x] 舊 key 只保留於中央歷史驗證，不移到新電腦；舊 policy cache 也不轉移。
- [x] 遺失裝置上的 pending evidence 被記為 explicit unrecoverable gap，不被標示為已上傳或正常刪除。
- [x] scenario 覆蓋 offline queue、重啟續傳、duplicate batch、retention boundary、replacement 與 lost-device gap。


## Answer

- `evidenceUpload.ts`: ordered queue, idempotent ack, retention excludes unacked, device-retired / device-replaced with unrecoverable gap flag.
- smoke-outbound-phase2.

