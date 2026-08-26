# 03 — attachment record + 終局保留

Status: 可交給代理
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

依 01 的決策,在選定的那一層為每個 `runId` 保留一份 attachment record:目前狀態(active／terminal 分類)、Turn Record 的 `latestSeq` high-watermark、終局結果、acknowledgement 狀態。

關鍵改動:`turn/submit` 的結果**寫進這份 record**,而不是只回覆給當初發起的 `ipcRenderer.invoke`。今天 renderer 一旦銷毀,那個 invoke 的 promise 就沒人接,Host 算完的結果直接落進虛空——這張票就是給結果一個落地的地方。

保留是有界的:到 renderer 明確 ack,或保留策略到期為止(兩者都要有明確上限,不得無界成長)。record 只存有界 metadata,不存 prompt、工具輸出或憑證。

本票是 tracer bullet:先讓「結果不再遺失」成立,之後的票才有東西可附著。

## Acceptance criteria

- [ ] 每個 run 有 attachment record,鍵為 `runId`(thread／session／turn identity 一併保存以供比對)
- [ ] `turn/submit` 的終局結果寫入 record;renderer 不在時不遺失
- [ ] 保留有明確上限(ack 或 TTL),記憶體不隨 run 數無界成長
- [ ] record 只含有界 metadata;無 prompt／工具輸出／raw connector 憑證
- [ ] `latestSeq` high-watermark 隨 Host 的 record append 前進,且單調
- [ ] 既有 `turn/submit` 行為(正常路徑仍直接回覆 invoke)不回歸
- [ ] 落地位置與保留策略符合 01 的決策記錄
- [ ] `npm run build` 通過

## Blocked by

01 — 決定重新附著的真相歸屬
