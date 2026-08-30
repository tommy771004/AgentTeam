# 02 — Admission workspace binding 與 baseline

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

在唯一 `taskRunCoordinator.runTask` admission 凍結 repo root、project/worktree identity、HEAD、index／working revision 與 runner kind，並建立 pending snapshot。Git discovery 必須支援 project 位於 repo 子目錄、worktree `.git` file、spaces/non-ASCII 與跨平台 path normalization；renderer 不解析第二份 binding。

## Acceptance criteria

- [x] 每個 admitted run 只有一份 immutable workspace binding，settlement/recovery 重用同一 identity
- [x] normal repo、nested project、linked worktree、non-Git project fixtures 通過
- [x] baseline capture failure 留下 typed failed review status，但不阻斷正常 run lifecycle
- [x] plain-browser degrade 明確 non-canonical，且 feature-detect bridge
- [x] admission drift guard 證明 UI 沒有直接建立 snapshot 或 Git identity

## Blocked by

01 — Review target 與 attribution contract

## Comments

- 2026-08-30：新增 Host-owned `reviewWorkspaceBinding`，正確解析 nested repo、linked worktree common Git dir、canonical project/worktree identity，並在 admission 凍結 HEAD、index/working revision 與 runner kind。`review-v1` 經 Pi Host protocol／Supervisor／IPC／preload feature-detect bridge 接入唯一 `runTask` seam；同一 `ReviewAdmissionSnapshot` 被放入 dispatch 與 finalization，不在 settlement 重算 Git identity。無 Host 或無 project root 時只建立 explicit non-canonical failed projection，run lifecycle 照常繼續。
- Gate evidence：`smoke-review-workspace-binding.mts` 覆蓋 normal／nested／linked worktree／non-Git／capture failure、真 Pi Host request 與 renderer drift guard，已掛入 `npm run smoke`；focused smokes、app/node TypeScript、complexity、Pi Host protocol/supervisor/capability 與 run lifecycle smokes 全綠。
