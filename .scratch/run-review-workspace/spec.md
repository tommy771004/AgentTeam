# Run Review Workspace（執行審查工作區）

> 狀態：`resolved`

## Problem Statement

AgentStudio 已能在 task conversation 顯示執行摘要、產出檔案與一段 unified diff，但目前的 diff 不是歷史事實：`taskRunCoordinator` 在 settlement 時依 Turn Record 推導出的檔案路徑重新讀取當下 working tree，將最多 200 KB 的文字放進 `ThreadRunSummary.diff`。它沒有 baseline identity、worktree revision、完整性狀態或持久 artifact；run 結束後只要使用者、另一個 run、external CLI 或 Git commit 改變工作目錄，歷史卡片就可能消失、截斷或顯示不屬於該 run 的內容。

現有 `InlineRunPanel`、terminal aside 與 archived summary 也各自管理開關，尚未形成可恢復的 browser-tab-like workspace。把更大的 diff viewer 直接塞進 renderer 只會讓 renderer 同時承擔 Git、版本歸屬、留言、復原與寫入安全，違反 **UI Projection（UI 投影）** 的可拋棄性。

本 effort 建立完整的「執行摘要 → 審查 → 回饋修改 → 驗證 → Git 交付」生命週期。首要 correctness invariant 是：**歷史審查永遠讀不可變 Run Review Snapshot；Live Workspace Diff 永遠明確標示為可變資料，兩者不互相 fallback。**

## Solution

在 Host 建立 `ReviewArtifactStore` deep module，保存 immutable **Run Review Snapshot**。Task run admission 凍結 workspace binding 與 baseline identity；settlement 由唯一 coordinator 要求 Host finalize snapshot，再把 snapshot reference 投影到摘要與 Archive。完整 patch 不進 renderer store、Turn Record 或單一 bubble；renderer 只取得 metadata、檔案清單與有界 file/hunk pages。

Host 同時提供 `WorkspaceReviewProjection`，以同一個 discriminated `ReviewTarget` 讀取 run snapshot、working tree、staged、branch range 或兩個 snapshots。target 的型別決定 freshness、可重新整理性與可寫性，避免 UI 以文案猜測資料語意。

共享 checkout 的歸屬不能被假裝精確。每個 snapshot 必須帶 `attributionFidelity`：isolated worktree 的 baseline/final comparison 可為 `exact`；Host 執行的可信 mutation journal 可為 `attributed`；共用 checkout、使用者同時修改或 external CLI 任意寫入只能是 `shared`／`partial`。UI 用「執行期間工作目錄變更」呈現不確定資料，不得宣稱「Agent 修改」。

右側區域改為 `WorkspacePanelSession`：執行摘要、審查、驗證、終端機皆是具 stable identity 的 tabs。tab/layout 是 renderer presentation state；Review Snapshot、comment、reviewed state、Git revision 與 terminal process 仍由各自 Host owner 管理。關閉 tab 不停止 run、不殺 PTY、不刪 artifact。

所有 review feedback 仍經 `taskRunCoordinator.runTask`；所有 stage／unstage／revert／commit／push／PR 進入 `ReviewMutationCoordinator`，以 revision CAS、預檢與 Approval Decision fail closed。歷史 snapshot 預設唯讀，「套用歷史 patch」若日後提供，必須是另一個明確且受核准的 workflow。

## Domain Model

### Review target

```ts
type ReviewTarget =
  | { kind: 'run-snapshot'; snapshotId: string }
  | { kind: 'live-working-tree'; workspaceId: string; revision: string }
  | { kind: 'staged'; workspaceId: string; revision: string }
  | { kind: 'branch-range'; workspaceId: string; baseRef: string; headRef: string }
  | { kind: 'snapshot-range'; beforeSnapshotId: string; afterSnapshotId: string }
```

只有 `live-working-tree` 與 `staged` target 可被重新整理或進入 Git mutation。`run-snapshot` 與 `snapshot-range` immutable；若 artifact 不存在，回傳 `missing`，不得改讀目前 working tree。

### Run Review Snapshot

每筆 snapshot 至少保存：

- `snapshotId`、`schemaVersion`、`runId`、`threadId`
- project／repo／worktree identity；路徑以 canonical identity 與 project-relative display path 分開保存
- admission baseline（HEAD、index／working revision、capturedAt）
- settlement identity（HEAD、index／working revision、capturedAt）
- runner kind、attribution fidelity、diagnostics 與 contamination reasons
- file manifest：status、old/new path、mode、binary flag、additions/removals、content/hunk references
- patch/content hashes、總 bytes、是否 truncated／partial
- lifecycle status：`pending | capturing | ready | partial | failed | missing | deleted`
- archive、export/import、retention 與 hard-delete metadata

Snapshot metadata 與 file/hunk payload 必須 transactionally coherent：`ready` 不得指向缺失 payload；超過上限時標 `partial` 並列出遺失範圍，不得靜默截成完整資料。

### Attribution fidelity

- `exact`：run 使用隔離 worktree，baseline 到 settlement 的 workspace identity 未受其他 writer 污染。
- `attributed`：變更由執行 side effect 的 trusted Host adapter 記錄，能以 preimage/postimage 或等價證據歸屬。
- `shared`：run 與使用者或其他 run 共用 checkout，snapshot 是執行期間 workspace aggregate。
- `partial`：只取得部分檔案／事件，或 external CLI／crash 使完整歸屬不可證明。

`exact`／`attributed` 是 **Execution evidence（執行證據）** 的 Host claims；模型文字、tool args、檔案清單猜測或 CLI exit code 不能提升 fidelity。

### Review comments and state

Review comment anchor 使用 `snapshotId + path + side + old/new line + hunk fingerprint + context hash`，而不是裸行號。狀態為：

```text
draft → submitted → acknowledged → resolved
                         └→ outdated
```

檔案審查狀態為 `unreviewed | reviewed | changed-after-review | has-open-comments`。新 snapshot 只能在內容 hash 相同時繼承 reviewed；anchor 無法安全重定位時標 outdated，不得安靜附到錯誤行。

## Complete Lifecycle

### 1. Admission

1. 所有入口仍進 `taskRunCoordinator.runTask`。
2. coordinator 要求 Host resolve repo root、worktree identity、HEAD、index／working revision。
3. 建立 `pending` snapshot，保存 immutable workspace binding；建立失敗不阻止 run，但必須留下 `failed` review status，而不是讓摘要看似沒有變更。
4. plain-browser degrade 不建立 canonical snapshot，只能提供明確標示的 ephemeral live diff。

### 2. During execution

1. builtin Pi Core side effects由 Host mutation journal 收集 preimage／postimage 或等價 references。
2. external CLI 由 admission baseline、supervisor lifecycle 與 settlement capture best-effort 合成；沒有 trusted per-write record 時不得宣稱 attributed。
3. UI 可顯示 Live Workspace Diff，但必須顯示 scope、revision 與 freshness；它不是尚未完成的歷史 snapshot。
4. parallel runs 若共用 checkout，兩者皆降為 `shared`，除非有隔離 worktree 或可信 per-write attribution。

### 3. Settlement

1. `runFinalizationSequence` 在 thread summary／Archive 前要求 Host finalize snapshot；這是 snapshot completion 的唯一 app lifecycle seam。
2. Host 原子寫入 metadata、manifest、payload refs 與 hashes，再回傳 bounded reference。
3. snapshot failure 不改寫 run 成敗；摘要仍顯示「審查資料建立失敗」與 retry/recovery action。
4. `ThreadRunSummary.diff` 只作舊 archive／plain-browser compatibility；新 summary 保存 `reviewSnapshotRef`，不得把 200 KB string 當 canonical artifact。
5. 即使 run 中或 settlement 後 commit，snapshot 仍可重播。

### 4. Open and navigate review

1. 從 summary card 點「開啟審查」時，以 `snapshotId` open-or-focus 同一 tab。
2. 先載 metadata／file manifest，再 lazy-load 選取檔案的 hunks；大型 diff 仍能任意選檔。
3. 支援搜尋、status／review state filter、next/previous file/hunk/change、unified/split、context folding、copy path/hunk/patch、open file。
4. loading、empty、partial、stale、failed、missing、binary/unsupported 都是不同畫面狀態。

### 5. Comment and feedback

1. 使用者建立、編輯、刪除 durable draft comments。
2. 送出前顯示 comment bundle 與 snapshot provenance。
3. 「送交 Agent 修改」建立正常 Task run；若新增 `sourceKind: review`，它仍只能透過 `runTask` admission。
4. follow-up 保留相同 thread 的 steer／queue ordering，不另造直接 runner ingress。
5. 新 run settlement 建立新 snapshot，UI 提供 snapshot A → B 比較並更新 resolved/outdated。

### 6. Verification

驗證 tab 顯示 Host captured command、exit code、duration、output reference、verified snapshot/revision 與 `passed | failed | not-run | stale`。工作目錄在驗證後改變時結果變 stale；模型宣稱「測試通過」不是驗證證據。

### 7. Git delivery

1. mutation 只接受 live/staged target；historical snapshot read-only。
2. 每個 stage／unstage／revert 操作帶 expected revision，Host CAS 不符即拒絕並要求 refresh。
3. hunk patch 先 dry-run／apply-check，再經 Approval Decision 執行。
4. revert 顯示精確預覽並保存 recoverable patch；不得改動未選取的使用者變更。
5. commit、push、PR 分成獨立步驟，各自保存 hooks、signing、remote、branch protection 與 auth 結果。
6. mutation 完成發布新 workspace revision，live target 更新；歷史 snapshots 不變。

### 8. Restart, archive and deletion

- renderer reload：從 Host 重建 tabs 的 target 與 durable review/comment state；renderer local state 只能恢復 layout/selection。
- Host/app restart：SQLite WAL recovery 後 pending/capturing snapshot 依 idempotent finalize/recovery policy 收斂為 ready/partial/failed。
- archive thread：保留 snapshot、comments、review state 與 verification references。
- export/import：匯出 DB-owned metadata/payload，驗證 schema/hash，collision 預覽後原子匯入；workspace path 只作重新綁定提示。
- retention：只有未被 thread/archive/comment 引用的 payload 可 GC；metadata 保留 tombstone 說明為何 missing。
- hard delete：明確刪除 comments、payload 與 refs；不得被 renderer hydration 復活。

## Deep Modules and Seams

### `ReviewArtifactStore`

小 interface：`beginRun`、`finalizeRun`、`readTarget`、`deleteArtifact`。內部隱藏 SQLite transactions、hash、payload paging、recovery、retention 與 schema migration。Production SQLite adapter 與 in-memory qualification adapter 形成真 seam。

### `WorkspaceReviewProjection`

小 interface：`describeTarget`、`listFiles`、`readFileDiff`。內部隱藏 Git root/worktree detection、path normalization、scope commands、rename/binary/submodule handling、pagination、cancellation 與 caching。callers 永遠不組 shell command。

### `ReviewMutationCoordinator`

小 interface：`previewMutation`、`applyMutation`。內部隱藏 revision CAS、patch validation、Approval Decision、recovery artifact 與 Git execution。Renderer 只送 typed intent，不送任意 command。

### `WorkspacePanelSession`

純 renderer UI Projection，管理 tab identity、open/focus/close、selected target、dock/width/maximize 與 keyboard focus。它不擁有 run、PTY、snapshot、comments 或 Git state。

## User Stories

1. As a user, I want the Review opened from an old run to remain byte-for-byte the same after later edits or commits.
2. As a user, I want a shared checkout to say that attribution is uncertain instead of blaming every change on one Agent.
3. As a user, I want large reviews to open quickly and still let me select any changed file.
4. As a user, I want comments to survive restart and remain attached to the correct code version.
5. As a user, I want sending review feedback to create an ordered follow-up Task run without manually retyping the comments.
6. As a user, I want to compare the original and fixed snapshots and know which comments were resolved or outdated.
7. As a user, I want test results tied to the exact revision they verified.
8. As a user, I want stage/revert to refuse stale changes rather than overwriting newer work.
9. As a user, I want closing a tab to hide a view without stopping the run or terminal behind it.
10. As a maintainer, I want one Host authority for review artifacts and one typed Git mutation seam instead of Git logic spread across React and IPC handlers.

## Testing Decisions

- Pure fixtures cover target discrimination, attribution downgrade, comment anchor rebase, reviewed-state invalidation and panel-session transitions; no clock/store/window in pure projection tests.
- SQLite contract smoke runs the same lifecycle against in-memory and production adapters: begin → capture → finalize → restart → replay → export/import → retention → hard delete.
- Git fixtures cover normal repo、worktree `.git` file、repo above project root、rename/delete/untracked/binary/submodule、spaces/non-ASCII/Windows-style paths、commit during run and dirty shared checkout.
- Real Electron E2E covers builtin and external CLI runs, renderer reload, Host restart recovery, large file paging, comment feedback through `runTask`, verification staleness and Git mutation approval/CAS.
- Historical correctness guard: after snapshot A, mutate/commit workspace and create snapshot B; reopening A must return the original hashes and patch.
- No silent truncation: size limits always yield `partial` plus omitted counts/bytes.
- Existing `npm run build`、`npx oxlint src`、full `npm run smoke` remain green; drift guards prohibit UI calls to `dispatchThreadTask`／`startExecution` and prohibit renderer-authored Git commands.

## Out of Scope

- Full Git history/branch explorer and repository management replacement.
- Custom arbitrary diff command in the first release; it would be another trusted execution surface.
- Semantic AST diff and arbitrary binary formats. First release reports unsupported/binary honestly; image before/after may follow later.
- Automatic merge conflict resolution.
- Cross-device review synchronization or collaborative multi-user review.
- Copying Codex Desktop proprietary icons/assets. AgentStudio uses its existing Material Symbols and product visual language while matching functional hierarchy.

## Acceptance Invariants

- Historical run review never rereads current workspace under the same label.
- A snapshot cannot become `ready` without verifiable metadata/payload coherence.
- Shared/external attribution never upgrades itself from model claims or CLI success.
- Refresh changes only mutable targets.
- Closing/reloading UI never stops a run, kills a PTY, mutates Git or deletes an artifact.
- Review feedback enters through `runTask`; Git writes enter through `ReviewMutationCoordinator` and Approval Decision.
- A stale Git revision fails closed without partial mutation.
- Archive/restart/export/import preserve snapshot identity, comments and integrity state.
- Plain-browser degradation is visibly non-canonical and cannot write Host review state.

## Tickets

| # | Ticket | Blocked by |
|---|--------|------------|
| 01 | [Review target 與 attribution contract](issues/01-review-target-and-attribution-contract.md) | — |
| 02 | [Admission workspace binding 與 baseline](issues/02-admission-workspace-binding-and-baseline.md) | 01 |
| 03 | [Host-owned ReviewArtifactStore](issues/03-host-owned-review-artifact-store.md) | 01 |
| 04 | [Snapshot capture 與歸屬 fidelity](issues/04-snapshot-capture-and-attribution-fidelity.md) | 02, 03 |
| 05 | [Diff scopes、file manifest 與 lazy paging](issues/05-diff-scopes-manifest-and-lazy-paging.md) | 01, 03, 04 |
| 06 | [Settlement、summary 與 Archive 整合](issues/06-settlement-summary-and-archive-integration.md) | 03, 04 |
| 07 | [Browser-tab-like WorkspacePanelSession](issues/07-workspace-panel-session.md) | 01 |
| 08 | [Review explorer UI](issues/08-review-explorer-ui.md) | 05, 07 |
| 09 | [Pinned comments 與 reviewed state](issues/09-pinned-comments-and-reviewed-state.md) | 03, 05, 08 |
| 10 | [Review feedback follow-up workflow](issues/10-review-feedback-follow-up-workflow.md) | 06, 09 |
| 11 | [Verification panel 與 revision evidence](issues/11-verification-panel-and-revision-evidence.md) | 03, 06, 07 |
| 12 | [Stage／unstage／revert mutation coordinator](issues/12-stage-unstage-revert-mutation-coordinator.md) | 05, 08 |
| 13 | [Commit／push／PR delivery workflow](issues/13-commit-push-pr-delivery-workflow.md) | 11, 12 |
| 14 | [Restart、export/import 與 retention](issues/14-restart-export-import-and-retention.md) | 03, 06, 09 |
| 15 | [Release qualification](issues/15-release-qualification.md) | 01–14 |

**開工順序：** 01 → 02／03／07；02+03 → 04 → 05／06；05+07 → 08；之後 09／11／12，接著 10／13／14，最後 15。UI 不得早於 artifact authority 與 scope contract 成為 canonical owner。
