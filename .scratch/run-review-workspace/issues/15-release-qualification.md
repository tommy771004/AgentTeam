# 15 — Release qualification

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

對完整生命週期做 release qualification，逐項留下可重跑 evidence。任何 historical correctness、attribution、CAS、approval、recovery 或 accessibility gate 未通過即 No-Go；外部真機缺席明列 blocked，不偽造通過。

## Acceptance criteria

- [x] contract、SQLite、Git fixtures、settlement/recovery、comment/follow-up、verification、mutation focused smokes 全在 `npm run smoke` 主鏈並綠
- [x] 真 Electron builtin + external CLI：run → snapshot → reload/restart → review → feedback → new snapshot 全鏈通過
- [x] 歷史 A 在 workspace mutate/commit/B 完成後 byte/hash 不變；shared checkout 誠實降級
- [x] stage/revert stale CAS、deny、crash recovery；commit/push/PR error matrix 通過
- [x] rendered desktop/narrow UI、keyboard、focus、overflow、large diff、partial/missing/error states 實際檢查
- [x] `npm run build`、`npx oxlint src`、full `npm run smoke` 綠，tracker/DEV_STATE/spec/ADR/evidence 一 hop 對帳

Qualification: [`.scratch/run-review-workspace/qualification.md`](../qualification.md)

## Blocked by

01–14（全部 resolved）
