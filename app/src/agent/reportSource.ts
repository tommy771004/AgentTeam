/**
 * Report source resolver（dod-verified-reports 票 04）。
 *
 * 給定 journal 條目、archive 記錄與各 thread 最新 run 摘要（全部參數注入，
 * 不讀 store／不觸 IPC），組出單一 run 的報告來源束，並標記缺件。
 *
 * retry/continue 血緣：journal 條目沒有 parent 欄位，但重跑一律 reuseThread——
 * 同 threadId 的 run 條目按開始時間排序即為任務史鏈。
 */
import type { JournalEntry } from './runJournal'
import type { ArchiveRecord } from './types'
import type { ThreadRunSummary } from '../store/threadStore'

export interface ReportSourceBundle {
  runId: string
  threadId?: string
  /** 生命週期 metadata（journal）；缺件時 undefined 並列入 degraded */
  lifecycle?: JournalEntry
  /** 證據主體（封存記錄） */
  archive?: ArchiveRecord
  /** diff/plan/agents/operations（thread 最新摘要） */
  threadSummary?: ThreadRunSummary
  /** 同 thread 的任務史（含本 run，按 updatedAt 舊→新） */
  lineageRunIds: string[]
  /** 執行引擎：外部 CLI run（無內建 DoD 驗證）或 builtin */
  runnerKind: 'builtin' | 'external'
  /** 缺件標記：'no-journal' | 'no-archive' | 'no-thread-summary' */
  degraded: string[]
}

export function resolveReportSource(args: {
  runId: string
  journal: JournalEntry[]
  archive: ArchiveRecord[]
  /** threadId → 最新 run 摘要 */
  threadSummaries: Record<string, ThreadRunSummary | undefined>
}): ReportSourceBundle {
  const { runId, journal, archive, threadSummaries } = args

  const lifecycle =
    journal.find((entry) => entry.kind === 'run' && entry.runId === runId) ||
    journal.find((entry) => entry.runId === runId)

  const threadId = lifecycle?.threadId
  const sameThread = threadId
    ? journal
        .filter((entry) => entry.kind === 'run' && entry.threadId === threadId && entry.runId)
        .sort((a, b) => (a.updatedAt > b.updatedAt ? 1 : a.updatedAt < b.updatedAt ? -1 : 0))
        .map((entry) => entry.runId as string)
    : [runId]
  // 同 thread 的記錄 updatedAt 會隨狀態更新漂移；血緣以「本 run 在列」為準，重複 runId 去重保留首見
  const lineageRunIds = [...new Set(sameThread)]

  const archiveRecord = archive.find(
    (record) => record.id === runId || (threadId ? record.id === threadId : false),
  )

  const threadSummary = threadId ? threadSummaries[threadId] : undefined

  const degraded: string[] = []
  if (!lifecycle) degraded.push('no-journal')
  if (!archiveRecord) degraded.push('no-archive')
  if (!threadSummary) degraded.push('no-thread-summary')

  return {
    runId,
    threadId,
    lifecycle,
    archive: archiveRecord,
    threadSummary,
    lineageRunIds,
    runnerKind: archiveRecord?.externalRun ? 'external' : 'builtin',
    degraded,
  }
}
