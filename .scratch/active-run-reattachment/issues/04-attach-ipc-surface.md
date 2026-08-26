# 04 — attach / ack 介面 + preload

Status: 可交給代理
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

renderer 取用 Pi Core Host attachment record 的介面,feature-detected。Pi Host Protocol v3 提供三個能力,main／preload 只做 typed relay:

- **attach**:回傳有界 snapshot(entries、`latestSeq`、`total`、`availableFromSeq`、Host run 狀態)加上 cursor 之後的 ordered events。缺口以明確欄位回報,每次至多 200 entries。
- **ack**:acknowledgement,釋放 03 的終局保留。
- **active query**:回傳目前仍有哪些 active run,供 05／07 使用。

01 已決定介面屬於 Pi Host Protocol。依 ADR-0038 把 protocol v2 升到 v3,更新 capability negotiation、shared types 與 protocol smoke；不得只在 main↔renderer IPC 私自建立一套未版本化 lifecycle contract。`sessions/record` 仍是 Turn Record 分頁來源,attach 合約只組合 run metadata、cursor 與有界 page。

renderer 一律以 `window.subagents?.x` 偵測,plain-browser 缺席時安靜降級。snapshot 必須有界(不得整段歷史一次搬運),且 `total` / `latestSeq` 要能讓 renderer 校準 monotonic high-watermark。

## Acceptance criteria

- [ ] attach 回傳有界 snapshot + cursor 之後的 ordered events,缺口為明確欄位
- [ ] ack 釋放保留;重複 ack 不報錯也不重複釋放
- [ ] 提供 active run 集合查詢(供 07)
- [ ] Pi Host Protocol 升到 v3,初始化 negotiation、shared types 與 protocol smoke 同步更新
- [ ] main／preload 只是 typed relay,不在 main 建立第二份 attachment truth
- [ ] renderer 端 `window.subagents?.x` feature-detect;plain browser 不炸
- [ ] 不回傳 prompt、工具輸出或 raw connector 憑證
- [ ] `npm run build` 通過

## Blocked by

03 — attachment record + 終局保留
