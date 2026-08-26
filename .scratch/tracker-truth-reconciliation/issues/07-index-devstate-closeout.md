# 07 — 收口：重寫 INDEX + DEV_STATE + 整體 qualification

**What to build:** 依 01–06 的證據重寫 `.scratch/INDEX.md` Active frontier；DEV_STATE 日期等於對帳日。qualification 清單照 spec 原文四項。

**Blocked by:** 02, 03, 04, 05, 06

**Status:** resolved

## Qualification 清單

- [x] INDEX 每個 `resolved` 列都能在一 hop 內指到 gate 上的綠 smoke。
- [x] 零死路徑（guard 保證）。
- [x] DEV_STATE 日期 = 對帳日（2026-08-26）。
- [x] 五個訊號來源各有對帳 Comments（本 effort issues 02–06）。

## Comments

**2026-08-26 — resolved。**

- INDEX 重寫完成：Active frontier 九列皆為核實後的真開工作（subscription-surface-hardening、trajectory #03、context-usage-panel、external-cli-durable-harness、harness-gap-closure 七張未動、active-run-reattachment 待補勾註記、runtime-contract 三張殘餘、subdesign 兩 effort）；resolved 表每列附一 hop 證據欄；Known residuals 四條；待維護者裁決 queue 兩條；死連結改下場註記。
- Guard 對改寫後 INDEX 實跑綠（exit 0）；`docs/agents/triage-labels.md` 規則入冊；DEV_STATE 同日重寫。
- **誠實備注**：工作樹當下有 subscription-surface-hardening 的未提交 WIP（另一 session 編輯中），完整 `npm run smoke` 全鏈綠由該 effort 收口的 gate run 一併確認；已提交狀態 `b8e1888` 的 gate 由維護者 attest（commit message「release gate 轉綠」）。本 effort 引用的每一支 smoke 已用 check-pi-contract 同款展開演算法靜態核實為 gate-reachable。
