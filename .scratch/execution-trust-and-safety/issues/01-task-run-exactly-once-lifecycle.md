# 01 — 保證 Task run 的 exactly-once lifecycle

Status: resolved
**What to build:** 讓每個 Task run 只能被接納、執行與完成一次。使用者無論從 Chat turn、重試或自動化來源送出重複 `runId`，都只會看到一個真實的 Loop run 與一個可追溯的終態，不會重複寫入對話、封存、排程結算或佇列排空。

**Blocked by:** None — can start immediately.

- [x] 重複 `runId` 以明確的非成功結果結束，且不會啟動第二個 Loop run。
- [x] 對同一 `runId`，對話輸出、Archive、`onSettled`、容量釋放與 queue drain 各只發生一次。
- [x] 互動與自動化來源皆有外部行為回歸測試，驗證 duplicate admission 不會留下 running 狀態或重複副作用。

## Comments

### 2026-07-16 — TDD slice 1–2 (exactly-once admission)

- Seam: scenario E2E `runTask` + pure `taskRunAdmission` (production import).
- Interactive: `trust-01` composer → retry same `runId` → `skipReason: 'duplicate'`; single LLM / Archive / `onSettled` / user bubble; post-success re-admit also blocked.
- Automation: `trust-01` schedule concurrent path same contract + job result once.
- Production: `app/src/agent/taskRunAdmission.ts`; pre-capacity reject in `runExternal`; `markTaskRunFinalized` in `finalizeTaskRun`.
- Status: checklist complete for 01; ready for review / close after full `npm run smoke` on a machine with complete toolchain.
