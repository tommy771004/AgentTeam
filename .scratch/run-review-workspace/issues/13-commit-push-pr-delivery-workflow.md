# 13 — Commit／push／PR delivery workflow

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

在 mutation coordinator 上建立分段 Git delivery：選取 staged revision → 編輯/驗證 commit message → hooks/signing commit → push → create PR。每一步是獨立可重試、可稽核、受 Approval Decision 控制的狀態，不把 force/protected branch/auth failure 壓成 generic error。

## Acceptance criteria

- [x] commit 只消費使用者確認的 staged revision；CAS 不符不提交
- [x] hooks/signing/empty commit/identity 缺失輸出可診斷，成功後保存 commit identity
- [x] push remote/upstream/protected branch/force policy/auth errors 分類且不靜默放寬
- [x] PR action 只在 push identity 可證明時啟用，避免重複建立
- [x] commit/push 後歷史 Review Snapshot 仍可讀；live working tree 正確更新為 clean 或剩餘變更

## Completion evidence

- Host `ReviewDeliveryCoordinator` 以 staged `indexRevision` 做 preview/apply 雙重 CAS；commit receipt 保存 Host-issued `commitId`、commit/tree OID、branch 與被消費的 index revision，renderer 不能只靠自報 SHA 進入 push。
- commit 保留 repository signing 設定並支援明確 signing request；empty、identity、signing 與 executable commit-hook failure 有分離分類及 bounded diagnostic output。
- push 只接受目前 checkout branch 與既有 upstream；無 upstream 時要求明確 remote + set-upstream，remote 必須存在，force fail closed，protected/auth/non-fast-forward 維持獨立 failure code，成功後以 `ls-remote` 證明 remote OID。
- PR 僅接受 Host-issued verified `pushId`，preview/apply 都查既有 PR，重複 identity 不再呼叫 create；commit、push、PR 每一步各自走 `requestPiToolApproval` 並保存 Electron-main audit。
- Review Explorer 的 staged surface 提供 Commit → Push → PR 分段預覽與核准，commit 後保留 panel 狀態以繼續 delivery，並可開啟 Host 發布的 live working-tree revision 檢視剩餘變更。
- `smoke-review-delivery-coordinator` 覆蓋 stale/deny、僅消費 staged、hook、empty、upstream/remote/force、forged identity、push remote proof、PR 去重與 historical snapshot immutability；完整 `smoke:review-workspace-binding`、focused oxlint、TypeScript 與 `npm run build` 通過。

## Blocked by

11 — Verification panel 與 revision evidence; 12 — Stage／unstage／revert mutation coordinator
