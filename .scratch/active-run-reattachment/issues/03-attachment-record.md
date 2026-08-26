# 03 — attachment record + 終局保留

Status: resolved
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

依 01 的決策,在 **Pi Core Host child 的持久化 Host state／journal** 為每個 `runId` 保留一份 attachment record:目前狀態(active／terminal 分類)、Turn Record 的 `latestSeq` high-watermark、Pi execution settlement、終局結果摘要、acknowledgement 狀態。main supervisor 不保存可獨立演進的鏡像 record。

關鍵改動:`turn/submit` 的結果**寫進這份 record**,而不是只回覆給當初發起的 `ipcRenderer.invoke`。今天 renderer 一旦銷毀,那個 invoke 的 promise 就沒人接,Host 算完的結果直接落進虛空——這張票就是給結果一個落地的地方。

保留是有界的:active 到 terminal；terminal 到 renderer 明確 ack 或 24 小時 TTL,最多 256 筆。單筆 renderer-facing terminal summary 最多 64 KiB；record 只存有界 metadata,不存 prompt、完整工具輸出或憑證。Turn Record 不複製進 record。

本票是 tracer bullet:先讓「結果不再遺失」成立,之後的票才有東西可附著。

## Acceptance criteria

- [x] 每個 run 有 attachment record,鍵為 `runId`(thread／session／turn identity 一併保存以供比對)
- [x] `turn/submit` 的終局結果寫入 record;renderer 不在時不遺失
- [x] 保留符合決策:terminal 到 ack 或 24 小時 TTL、最多 256 筆；清理不逐出 active record
- [x] terminal summary 上限 64 KiB；Turn Record entries 不在 attachment metadata 複製一份
- [x] record 只含有界 metadata;無 prompt／工具輸出／raw connector 憑證
- [x] `latestSeq` high-watermark 隨 Host 的 record append 前進,且單調
- [x] 既有 `turn/submit` 行為(正常路徑仍直接回覆 invoke)不回歸
- [x] 落地於 Pi Core Host journal；main supervisor 只有 relay／subscription state,沒有第二份 lifecycle truth
- [x] `npm run build` 通過

## Blocked by

01 — 決定重新附著的真相歸屬

## Implementation evidence (2026-08-26)

- `PiHostAttachmentJournal` 持久化 active／terminal metadata、24 小時 TTL、256 筆 terminal 上限、64 KiB summary、單調 `latestSeq`，active records 不受 terminal pruning 逐出。
- `turn/submit` 仍回覆原 invoke，同時先將 Host settlement 寫入 attachment state；Turn Record entries 只由 session record 分頁提供。
- `smoke-pi-host-supervisor.mts`、`smoke-pi-host-protocol.mts` 與 `npm run build` 全綠。
