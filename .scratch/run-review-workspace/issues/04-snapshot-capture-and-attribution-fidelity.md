# 04 — Snapshot capture 與歸屬 fidelity

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

把 admission baseline、Pi Core Host trusted mutation journal、external CLI supervisor outcome 與 settlement workspace identity 合成 Run Review Snapshot。隔離 worktree 可為 exact；可信 side-effect pre/post evidence 可為 attributed；shared checkout、使用者/parallel run 污染與任意 CLI writes 必須降級並列出 reasons。

## Acceptance criteria

- [x] builtin write/edit/delete/move 與 external CLI 都能產生 snapshot 或 typed partial/failed
- [x] parallel runs 共用 checkout、使用者中途修改、同檔競寫、run 中 commit fixtures 不會誤報 exact
- [x] model text、tool args、produced-file projection、CLI exit 0 都不能提升 fidelity
- [x] rename/delete/untracked/mode/binary/symlink/submodule 有明確 manifest 語意
- [x] crash/cancel/timeout settlement 仍 best-effort finalize，且 provenance 可稽核

## Blocked by

02 — Admission workspace binding 與 baseline; 03 — Host-owned ReviewArtifactStore

## Comments

- 2026-08-30：新增 Host-only snapshot capture seam，從 immutable admission baseline 與 settlement workspace capture 產生 per-file patch payload、manifest modes/status/stats 與 bounded diagnostics。fidelity 只接受 Host input：isolated worktree 且 HEAD/parallel/contamination 均穩定才是 `exact`；完整 trusted mutation path coverage 才是 `attributed`；shared checkout／parallel／競寫／run 中 commit 降為 `shared`；External CLI 與不完整 capture 為 `partial`。模型文字、tool args、produced-file projection 與 CLI exit code不在輸入契約內。
- Manifest evidence：Git fixtures 實際覆蓋 rename、delete、untracked、executable mode、binary、symlink type change 與 submodule gitlink；cancel/timeout 仍 best-effort capture，capture failure 回 typed failed/partial diagnostics。
- Gate evidence：`smoke-review-snapshot-capture.mts` 已由 `smoke:review-workspace-binding` 掛入主 `npm run smoke`；focused smoke、app TypeScript 與 oxlint 全綠。
