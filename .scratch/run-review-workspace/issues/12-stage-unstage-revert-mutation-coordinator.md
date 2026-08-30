# 12 — Stage／unstage／revert mutation coordinator

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

建立 Host `ReviewMutationCoordinator`，只接受 typed file/hunk intent、mutable target 與 expected revision。preview 產生精確 patch/impact；apply 執行 CAS、apply-check、Approval Decision、recoverable patch 與新 revision publication。Renderer 不組 Git command。

## Acceptance criteria

- [x] stage/unstage/revert file 與 hunk 均先 preview，stale revision 原子拒絕
- [x] historical snapshot actions disabled；「套用歷史 patch」不混入本票
- [x] unrelated user changes 不被 stage/revert；同檔 overlap fail closed
- [x] revert 保存可恢復 patch並顯示精確確認，deny/cancel 不產生 side effect
- [x] command injection/path traversal/symlink/worktree/rename/binary fixtures 與 Approval audit 通過

## Completion evidence

- Host `ReviewMutationCoordinator` 只接受 typed mutable target、file/hunk selection 與 expected revision；preview 保存 bounded exact patch/hash/impact，apply 再驗 CAS 與 `git apply --check`。
- Git 全程使用 argv + stdin，renderer 不組 command；path traversal、symlink escape、shell metacharacter與 immutable target fail closed。
- apply 經既有 `requestPiToolApproval`，deny/cancel 不執行；revert 在 mutation 前以 mode `0600` 保存 recoverable patch。
- Review Explorer 提供 file/hunk 範圍、精確 patch 預覽及 stage/unstage/revert；成功後以 Host 發布的新 working/index revision 開啟對應 live/staged target。
- `smoke-review-mutation-coordinator` 覆蓋 hunk、deny、stale、unrelated change、recovery、path traversal、command injection、symlink、historical target、rename、binary 與 linked worktree；整組 `smoke:review-workspace-binding`、complexity、雙 tsconfig 與 `npm run build` 通過。

## Blocked by

05 — Diff scopes、file manifest 與 lazy paging; 08 — Review explorer UI
