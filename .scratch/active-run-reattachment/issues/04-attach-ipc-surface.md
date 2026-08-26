# 04 — attach / ack 介面 + preload

Status: 可交給代理
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

renderer 取用 attachment record 的介面,feature-detected。兩個方法:

- **attach**:回傳有界 snapshot(entries、`latestSeq`、`total`、run 狀態)加上 cursor 之後的 ordered events。缺口以明確欄位回報。
- **ack**:acknowledgement,釋放 03 的終局保留。

另外需要一個「目前仍有哪些 active run」的查詢,供 07 使用。

介面放在哪一層(main↔renderer IPC,或 Pi Host Protocol)由 01 決定。若 01 選 A,則**不新增 Pi Host Protocol 方法**——`sessions/record` 的 cursor API 已存在且足夠,故不觸發 ADR-0038 版本升級;若 01 選 B,則需依 ADR-0038 升版。

renderer 一律以 `window.subagents?.x` 偵測,plain-browser 缺席時安靜降級。snapshot 必須有界(不得整段歷史一次搬運),且 `total` / `latestSeq` 要能讓 renderer 校準 monotonic high-watermark。

## Acceptance criteria

- [ ] attach 回傳有界 snapshot + cursor 之後的 ordered events,缺口為明確欄位
- [ ] ack 釋放保留;重複 ack 不報錯也不重複釋放
- [ ] 提供 active run 集合查詢(供 07)
- [ ] protocol 版本處置符合 01 的決策(選 A 則不新增 protocol 方法且版本不動)
- [ ] renderer 端 `window.subagents?.x` feature-detect;plain browser 不炸
- [ ] 不回傳 prompt、工具輸出或 raw connector 憑證
- [ ] `npm run build` 通過

## Blocked by

03 — attachment record + 終局保留
