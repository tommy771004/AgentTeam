/**
 * Local-first lifecycle journal for runs that may outlive a renderer process.
 *
 * The journal deliberately stores only bounded metadata (never prompts,
 * tool payloads, credentials, or source files).  It is synchronous so an
 * admission/terminal marker is persisted before the coordinator can yield.
 */

export type JournalKind = 'run' | 'queue' | 'schedule' | 'background'
export type JournalStatus =
  | 'queued'
  | 'dispatching'
  | 'admitted'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type JournalEntry = {
  id: string
  kind: JournalKind
  status: JournalStatus
  runId?: string
  threadId?: string
  queueId?: string
  scheduleJobId?: string
  objective?: string
  sourceKind?: string
  attempt: number
  startedAt: string
  updatedAt: string
  finishedAt?: string
}

export type RecoveryItem = {
  kind: JournalKind | 'storage'
  id: string
  previousStatus?: JournalStatus
  action: 'marked-interrupted' | 'resume-once' | 'restored' | 'quarantined'
  detail?: string
}

export type RecoveryReport = {
  id: string
  at: string
  items: RecoveryItem[]
  delivered?: boolean
}

type JournalState = {
  version: 1
  entries: JournalEntry[]
  updatedAt: string
}

const JOURNAL_KEY = 'subagents.runJournal.v1'
const JOURNAL_BACKUP_KEY = 'subagents.runJournal.v1.backup'
const REPORT_KEY = 'subagents.recoveryReports.v1'
const MAX_ENTRIES = 300
const MAX_REPORTS = 20
const MAX_RAW_BYTES = 512_000
const JOURNAL_STATUSES = new Set<JournalStatus>([
  'queued',
  'dispatching',
  'admitted',
  'running',
  'success',
  'failed',
  'cancelled',
  'interrupted',
])

let startupRecoveryDone = false
let resolveStartupRecovery: (() => void) | null = null
const startupRecoveryReady = new Promise<void>((resolve) => {
  resolveStartupRecovery = resolve
})

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function now(): string {
  return new Date().toISOString()
}

function bounded(value: unknown, max: number): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, max) : undefined
}

function emptyState(): JournalState {
  return { version: 1, entries: [], updatedAt: now() }
}

function parseState(raw: string | null): JournalState | null {
  if (!raw || raw.length > MAX_RAW_BYTES) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value.version !== 1 || !Array.isArray(value.entries)) return null
    if (value.entries.length > MAX_ENTRIES * 2) return null
    const entries = value.entries
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      .map((entry) => ({
        id: bounded(entry.id, 160),
        kind: entry.kind as JournalKind,
        status: entry.status as JournalStatus,
        runId: bounded(entry.runId, 160),
        threadId: bounded(entry.threadId, 160),
        queueId: bounded(entry.queueId, 160),
        scheduleJobId: bounded(entry.scheduleJobId, 160),
        objective: bounded(entry.objective, 240),
        sourceKind: bounded(entry.sourceKind, 80),
        attempt: Math.max(1, Number(entry.attempt) || 1),
        startedAt: bounded(entry.startedAt, 40) || now(),
        updatedAt: bounded(entry.updatedAt, 40) || now(),
        finishedAt: bounded(entry.finishedAt, 40),
      }))
      .filter(
        (entry) =>
          Boolean(entry.id) &&
          ['run', 'queue', 'schedule', 'background'].includes(entry.kind) &&
          JOURNAL_STATUSES.has(entry.status),
      )
    if (entries.length !== value.entries.length) return null
    return { version: 1, entries: entries as JournalEntry[], updatedAt: bounded(value.updatedAt, 40) || now() }
  } catch {
    return null
  }
}

function retainedEntries(entries: JournalEntry[]): JournalEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries
  const active = entries.filter((entry) =>
    ['queued', 'dispatching', 'admitted', 'running'].includes(entry.status),
  )
  const terminal = entries.filter((entry) => !active.includes(entry))
  const keptActive = active.slice(-MAX_ENTRIES)
  const terminalBudget = Math.max(0, MAX_ENTRIES - keptActive.length)
  return [...terminal.slice(-terminalBudget), ...keptActive]
}

function loadState(): JournalState {
  const store = storage()
  if (!store) return emptyState()
  let primaryRaw: string | null = null
  let backupRaw: string | null = null
  try {
    primaryRaw = store.getItem(JOURNAL_KEY)
    backupRaw = store.getItem(JOURNAL_BACKUP_KEY)
  } catch {
    return emptyState()
  }
  const primary = parseState(primaryRaw)
  if (primary) return primary

  const backup = parseState(backupRaw)
  if (primaryRaw && backup) {
    try {
      store.setItem(JOURNAL_KEY, JSON.stringify(backup))
      appendRecoveryReport({
        kind: 'storage',
        id: JOURNAL_KEY,
        action: 'restored',
        detail: 'Run journal primary state was restored from its last-known-good backup.',
      })
    } catch {
      /* best effort */
    }
    return backup
  }
  if (primaryRaw) {
    try {
      store.setItem(`${JOURNAL_KEY}.corrupt.${Date.now()}`, primaryRaw.slice(0, 500_000))
      store.removeItem(JOURNAL_KEY)
      appendRecoveryReport({
        kind: 'storage',
        id: JOURNAL_KEY,
        action: 'quarantined',
        detail: 'Run journal state was invalid and was quarantined without deleting the backup.',
      })
    } catch {
      /* best effort */
    }
  }
  return emptyState()
}

function persistState(state: JournalState): void {
  const store = storage()
  if (!store) return
  const next = {
    ...state,
    entries: retainedEntries(state.entries),
    updatedAt: now(),
  }
  try {
    const current = store.getItem(JOURNAL_KEY)
    if (current) store.setItem(JOURNAL_BACKUP_KEY, current)
    store.setItem(JOURNAL_KEY, JSON.stringify(next))
  } catch {
    /* localStorage may be unavailable or full; execution must continue */
  }
}

function appendRecoveryReport(item: RecoveryItem): void {
  const store = storage()
  if (!store) return
  try {
    const current = JSON.parse(store.getItem(REPORT_KEY) || '[]') as RecoveryReport[]
    const report: RecoveryReport = {
      id: `recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      at: now(),
      items: [item],
    }
    store.setItem(REPORT_KEY, JSON.stringify([...current, report].slice(-MAX_REPORTS)))
  } catch {
    /* recovery reporting must not block startup */
  }
}

function upsert(entry: Omit<JournalEntry, 'attempt' | 'startedAt' | 'updatedAt'> & Partial<Pick<JournalEntry, 'attempt' | 'startedAt'>>): void {
  const state = loadState()
  const at = now()
  const index = state.entries.findIndex((item) => item.kind === entry.kind && item.id === entry.id)
  const previous = index >= 0 ? state.entries[index] : undefined
  const next: JournalEntry = {
    ...previous,
    ...entry,
    attempt: Math.max(1, entry.attempt || previous?.attempt || 1),
    startedAt: entry.startedAt || previous?.startedAt || at,
    updatedAt: at,
  }
  if (index >= 0) state.entries[index] = next
  else state.entries.push(next)
  persistState(state)
}

function terminalStatus(status: string): JournalStatus {
  if (status === 'success') return 'success'
  if (status === 'cancelled' || status === 'skipped') return 'cancelled'
  if (status === 'interrupted') return 'interrupted'
  return 'failed'
}

export function recordRunAdmitted(input: {
  runId: string
  objective: string
  sourceKind?: string
  scheduleJobId?: string
}): void {
  upsert({
    id: input.runId,
    kind: 'run',
    status: 'admitted',
    runId: input.runId,
    objective: bounded(input.objective, 240),
    sourceKind: bounded(input.sourceKind, 80),
    scheduleJobId: bounded(input.scheduleJobId, 160),
  })
}

export function recordRunStarted(input: { runId: string; threadId?: string }): void {
  upsert({ id: input.runId, kind: 'run', status: 'running', runId: input.runId, threadId: bounded(input.threadId, 160) })
}

export function recordRunTerminal(input: { runId: string; threadId?: string; status: string }): void {
  const finishedAt = now()
  upsert({
    id: input.runId,
    kind: 'run',
    status: terminalStatus(input.status),
    runId: input.runId,
    threadId: bounded(input.threadId, 160),
    finishedAt,
  })
}

export function recordQueueEnqueued(input: {
  queueId: string
  runId?: string
  objective: string
  sourceKind?: string
}): void {
  upsert({
    id: input.queueId,
    kind: 'queue',
    status: 'queued',
    queueId: input.queueId,
    runId: bounded(input.runId, 160),
    objective: bounded(input.objective, 240),
    sourceKind: bounded(input.sourceKind, 80),
  })
}

export function recordQueueDispatching(input: { queueId: string; runId?: string }): void {
  const current = getJournalEntry('queue', input.queueId)
  upsert({
    id: input.queueId,
    kind: 'queue',
    status: 'dispatching',
    queueId: input.queueId,
    runId: bounded(input.runId, 160),
    attempt: (current?.attempt || 0) + 1,
  })
}

export function recordQueueTerminal(input: { queueId: string; status: string }): void {
  upsert({
    id: input.queueId,
    kind: 'queue',
    status: terminalStatus(input.status),
    queueId: input.queueId,
    finishedAt: now(),
  })
}

export function recordScheduleStatus(jobId: string, status: string, runId?: string): void {
  upsert({
    id: jobId,
    kind: 'schedule',
    status: status === 'running' ? 'running' : terminalStatus(status),
    scheduleJobId: bounded(jobId, 160),
    runId: bounded(runId, 160),
    finishedAt: status === 'running' ? undefined : now(),
  })
}

export function recordBackgroundStatus(input: {
  jobId: string
  runId?: string
  objective: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
}): void {
  upsert({
    id: input.jobId,
    kind: 'background',
    status: input.status,
    runId: bounded(input.runId, 160),
    objective: bounded(input.objective, 240),
    finishedAt: ['success', 'failed', 'cancelled'].includes(input.status) ? now() : undefined,
  })
}

export function getJournalEntry(kind: JournalKind, id: string): JournalEntry | undefined {
  return loadState().entries.find((entry) => entry.kind === kind && entry.id === id)
}

/** Mark uncertain in-flight work interrupted; never replay an uncertain side effect. */
export function reconcileStartup(): RecoveryReport | null {
  const state = loadState()
  const active = new Set<JournalStatus>(['admitted', 'running', 'dispatching'])
  const items: RecoveryItem[] = []
  for (const entry of state.entries) {
    if (!active.has(entry.status)) continue
    const previousStatus = entry.status
    entry.status = 'interrupted'
    entry.updatedAt = now()
    entry.finishedAt = entry.updatedAt
    items.push({
      kind: entry.kind,
      id: entry.id,
      previousStatus,
      action: 'marked-interrupted',
      detail: entry.objective ? `目標：${entry.objective}` : undefined,
    })
  }
  if (!items.length) return null
  persistState(state)
  const report: RecoveryReport = {
    id: `recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: now(),
    items,
  }
  const store = storage()
  if (store) {
    try {
      const current = JSON.parse(store.getItem(REPORT_KEY) || '[]') as RecoveryReport[]
      store.setItem(REPORT_KEY, JSON.stringify([...current, report].slice(-MAX_REPORTS)))
    } catch {
      /* best effort */
    }
  }
  return report
}

export function recordRecoveryNotice(item: RecoveryItem): void {
  appendRecoveryReport(item)
}

export function consumeRecoveryReports(): RecoveryReport[] {
  const store = storage()
  if (!store) return []
  try {
    const current = JSON.parse(store.getItem(REPORT_KEY) || '[]') as RecoveryReport[]
    const pending = current.filter((report) => !report.delivered)
    if (pending.length) {
      store.setItem(
        REPORT_KEY,
        JSON.stringify(current.map((report) => (report.delivered ? report : { ...report, delivered: true }))),
      )
    }
    return pending
  } catch {
    return []
  }
}

/** Queue and scheduler bootstraps must not run until reconciliation has settled. */
export function waitForStartupRecovery(): Promise<void> {
  return startupRecoveryDone ? Promise.resolve() : startupRecoveryReady
}

/** Resolve the startup barrier even when recovery is best-effort after a storage failure. */
export function completeStartupRecovery(): void {
  if (startupRecoveryDone) return
  startupRecoveryDone = true
  resolveStartupRecovery?.()
  resolveStartupRecovery = null
}

/** Test seam: clear only journal-owned local state. */
export function resetRunJournalForTests(): void {
  const store = storage()
  if (!store) return
  for (const key of [JOURNAL_KEY, JOURNAL_BACKUP_KEY, REPORT_KEY]) store.removeItem(key)
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i)
    if (key?.startsWith(`${JOURNAL_KEY}.corrupt.`)) store.removeItem(key)
  }
}
