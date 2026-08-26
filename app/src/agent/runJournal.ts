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

/**
 * Whether a terminal run's outcome actually reached the user.
 *
 * `delivered` — the finalizer wrote the outcome into the owning thread while a
 * renderer was on screen to show it.
 * `pending-delivery` — the run is terminal but nobody has been told yet.
 * `consumed` — a pending outcome has since been narrated (live toast or the
 * startup redelivery pass) and must never be narrated again.
 */
export type JournalDelivery = 'delivered' | 'pending-delivery' | 'consumed'

const JOURNAL_DELIVERIES = new Set<JournalDelivery>(['delivered', 'pending-delivery', 'consumed'])

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
  /** Set on terminal run entries only; see `classifyRunDelivery`. */
  delivery?: JournalDelivery
  /** `external` runs may never claim a Definition of Done. */
  executionKind?: 'loop' | 'external'
  /** Bounded settlement evidence — counters only, never prompts or payloads. */
  dodMet?: boolean
  iterations?: number
  maxIterations?: number
  /** Why a stopped run stopped: a user press or a spent time budget. */
  interruptReason?: 'user' | 'timeout'
  /**
   * Every context compaction this run performed: when, and how much of the
   * transcript it covered. Counts only — the pre-compaction text itself lives
   * in the durable checkpoint, never here.
   */
  compactions?: JournalCompaction[]
  /**
   * Proof that this run's knowledge digest reached the project's memory
   * directory. Absent means it did not — a model claiming otherwise is wrong
   * by construction (ADR-0048).
   */
  memorySink?: { at: string; path: string; bytes: number }
}

export type JournalCompaction = {
  at: string
  /** How many earlier messages the summary replaced. */
  replacedMessages: number
  /** Transcript length after the replacement, so the range is reconstructable. */
  remainingMessages: number
  summaryChars: number
  /** Estimated tokens that triggered the preflight, and the window it neared. */
  estimatedTokens?: number
  contextWindow?: number
}

const MAX_COMPACTIONS_PER_RUN = 40

export type RecoveryItem = {
  kind: JournalKind | 'storage'
  id: string
  previousStatus?: JournalStatus
  action:
    | 'marked-interrupted'
    | 'resume-once'
    | 'restored'
    | 'quarantined'
    /** A terminal outcome the user never saw was narrated after restart. */
    | 'redelivered'
    /** Terminal, but the owning thread is gone — no claim either way. */
    | 'result-unknown'
  detail?: string
}

export type RecoveryReport = {
  id: string
  at: string
  items: RecoveryItem[]
  delivered?: boolean
}

/**
 * Host-canonical startup truth. The renderer journal remains a local-first
 * delivery ledger; it must not decide that a Pi run died merely because this
 * renderer was destroyed.
 */
export type StartupHostTruth = {
  activeRunIds: ReadonlySet<string>
  terminalRunIds: ReadonlySet<string>
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

/**
 * Main-process durability bridge (feature-detected as `window.subagents.journal`).
 *
 * localStorage can be evicted under quota pressure and has no torn-write
 * protection, so every persisted state is also mirrored to userData through
 * the main process. The bridge is injected — never imported — so this module
 * stays importable in Node smokes and the renderer keeps feature-detecting.
 */
export type RunJournalMirrorBridge = {
  read: () => Promise<{ state: string } | null | undefined>
  write: (state: string) => Promise<unknown>
}

let mirrorBridge: RunJournalMirrorBridge | null = null

/** Wire the durable mirror; pass null to detach (tests). Idempotent. */
export function setRunJournalMirrorBridge(bridge: RunJournalMirrorBridge | null): void {
  mirrorBridge = bridge
}

function queueMirrorWrite(payload: string): void {
  const bridge = mirrorBridge
  if (!bridge) return
  // Fire-and-forget: a mirror failure must never block or fail the primary
  // write path. localStorage remains the read source; the mirror is recovery.
  try {
    void Promise.resolve(bridge.write(payload)).catch(() => { /* best effort */ })
  } catch {
    /* best effort */
  }
}

function storage(preferred?: Storage): Storage | null {
  if (preferred) return preferred
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

/**
 * Bounded non-negative counter; anything else is simply absent.
 *
 * `max` differs by field on purpose: iteration counts are single digits, while
 * a token estimate is six. One shared ceiling would silently drop the latter.
 */
function counter(value: unknown, max = 10_000): number | undefined {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : undefined
}

/** Token counts and window sizes run far past the iteration ceiling. */
const MAX_TOKEN_COUNT = 100_000_000

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
        // Unknown or malformed delivery metadata drops the field rather than
        // the entry: a bad enum must never quarantine a whole valid journal.
        delivery: JOURNAL_DELIVERIES.has(entry.delivery as JournalDelivery)
          ? (entry.delivery as JournalDelivery)
          : undefined,
        executionKind:
          entry.executionKind === 'loop' || entry.executionKind === 'external'
            ? entry.executionKind
            : undefined,
        dodMet: typeof entry.dodMet === 'boolean' ? entry.dodMet : undefined,
        iterations: counter(entry.iterations),
        maxIterations: counter(entry.maxIterations),
        interruptReason:
          entry.interruptReason === 'user' || entry.interruptReason === 'timeout'
            ? entry.interruptReason
            : undefined,
        memorySink:
          entry.memorySink
          && typeof entry.memorySink === 'object'
          && typeof (entry.memorySink as { path?: unknown }).path === 'string'
            ? (entry.memorySink as JournalEntry['memorySink'])
            : undefined,
        compactions: Array.isArray(entry.compactions)
          ? (entry.compactions as JournalCompaction[])
              .filter((item) => item && typeof item === 'object' && typeof item.at === 'string')
              .slice(-MAX_COMPACTIONS_PER_RUN)
          : undefined,
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
  // An outcome nobody has been told about is as unfinished as a running run:
  // both survive eviction so a completion cannot vanish before it is narrated.
  const protectedEntry = (entry: JournalEntry) =>
    ['queued', 'dispatching', 'admitted', 'running'].includes(entry.status) ||
    entry.delivery === 'pending-delivery'
  const active = entries.filter(protectedEntry)
  const terminal = entries.filter((entry) => !active.includes(entry))
  const keptActive = active.slice(-MAX_ENTRIES)
  const terminalBudget = Math.max(0, MAX_ENTRIES - keptActive.length)
  // Past the cap even after protection, the drop is reported instead of silent.
  for (const dropped of active.slice(0, active.length - keptActive.length)) {
    if (dropped.delivery !== 'pending-delivery') continue
    appendRecoveryReport({
      kind: dropped.kind,
      id: dropped.id,
      previousStatus: dropped.status,
      action: 'result-unknown',
      detail: `執行紀錄已達上限，未送達的結果被淘汰${dropped.objective ? `：${dropped.objective}` : ''}`,
    })
  }
  return [...terminal.slice(-terminalBudget), ...keptActive]
}

/**
 * Restore the journal from the durable main-process mirror when local storage
 * holds no usable entries.
 *
 * This covers the quiet failure mode where the browser evicted localStorage:
 * pending deliveries and interrupted runs still exist in the mirror, and the
 * startup redelivery pass needs them. Must run BEFORE `reconcileStartup()` so
 * recovery sees restored state rather than an empty journal. Returns whether a
 * restore happened.
 */
export async function hydrateRunJournalFromDurable(): Promise<boolean> {
  const store = storage()
  if (!store || !mirrorBridge) return false
  const existing = loadState(store)
  if (existing.entries.length > 0) return false
  let mirrored: { state?: unknown } | null | undefined
  try {
    mirrored = await mirrorBridge.read()
  } catch {
    return false
  }
  const raw = typeof mirrored?.state === 'string' ? mirrored.state : ''
  if (!raw) return false
  const restored = parseState(raw)
  if (!restored || restored.entries.length === 0) return false
  try {
    store.setItem(JOURNAL_KEY, raw)
  } catch {
    return false
  }
  appendRecoveryReport({
    kind: 'storage',
    id: JOURNAL_KEY,
    action: 'restored',
    detail: '本機 localStorage 已無可用執行紀錄，已從主程序日誌鏡像還原。',
  })
  return true
}

function loadState(preferred?: Storage): JournalState {
  const store = storage(preferred)
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
  const payload = JSON.stringify(next)
  try {
    const current = store.getItem(JOURNAL_KEY)
    if (current) store.setItem(JOURNAL_BACKUP_KEY, current)
    store.setItem(JOURNAL_KEY, payload)
  } catch {
    /* localStorage may be unavailable or full; execution must continue */
  }
  // Mirror even when the primary write threw: an evicted/full localStorage is
  // exactly the case the durable copy exists for.
  queueMirrorWrite(payload)
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
  // `halted` is the agent-side word for a run that was stopped, not one that
  // failed. Recording it as a failure would make the durable record disagree
  // with what the user was shown.
  if (status === 'cancelled' || status === 'skipped' || status === 'halted') return 'cancelled'
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

export type RunDeliveryFacts = {
  /** The run is bound to a conversation thread that still exists. */
  hasOwningThread: boolean
  /** The finalizer wrote this run's outcome into that thread. */
  resultWrittenToThread: boolean
  /** A renderer was mounted and on screen to present it. */
  rendererPresent: boolean
}

/**
 * The single rule for "did this outcome actually reach the user".
 *
 * UI never re-decides this: a surface that guesses would disagree with the
 * startup redelivery pass and either drop a completion or narrate it twice.
 */
export function classifyRunDelivery(facts: RunDeliveryFacts): JournalDelivery {
  return facts.hasOwningThread && facts.resultWrittenToThread && facts.rendererPresent
    ? 'delivered'
    : 'pending-delivery'
}

export type RunTerminalSettlement = {
  executionKind?: 'loop' | 'external'
  dodMet?: boolean
  iterations?: number
  maxIterations?: number
  interruptReason?: 'user' | 'timeout'
}

export function recordRunTerminal(input: {
  runId: string
  threadId?: string
  status: string
  delivery?: RunDeliveryFacts
  settlement?: RunTerminalSettlement
}): void {
  const finishedAt = now()
  const external = input.settlement?.executionKind === 'external'
  upsert({
    id: input.runId,
    kind: 'run',
    status: terminalStatus(input.status),
    runId: input.runId,
    threadId: bounded(input.threadId, 160),
    finishedAt,
    // Written in the same synchronous statement as the terminal marker: there
    // is no second write point that could disagree about delivery.
    delivery: input.delivery ? classifyRunDelivery(input.delivery) : 'pending-delivery',
    executionKind: input.settlement?.executionKind,
    // An external CLI exit is never a DoD claim, so its settlement carries no
    // DoD verdict at all rather than an unmet one.
    dodMet: external ? undefined : input.settlement?.dodMet,
    iterations: external ? undefined : counter(input.settlement?.iterations),
    maxIterations: external ? undefined : counter(input.settlement?.maxIterations),
    interruptReason: input.settlement?.interruptReason,
  })
}

/**
 * Mark a pending outcome as told, without changing the terminal status.
 *
 * Used by the live completion notice, so a run the user was shown while the app
 * was open is not narrated again as news on the next restart.
 */
/**
 * Record one context compaction against its run.
 *
 * The event is what tells a later reader that the agent's view of the
 * conversation was rewritten, and when. It is deliberately counts-only: the
 * text it replaced is retrievable from the durable checkpoint instead.
 */
export function recordRunCompaction(runId: string, event: Omit<JournalCompaction, 'at'>): void {
  if (!runId) return
  const state = loadState()
  const entry = state.entries.find((item) => item.kind === 'run' && item.id === runId)
  if (!entry) return
  const compaction: JournalCompaction = {
    at: now(),
    replacedMessages: Math.max(0, Math.floor(Number(event.replacedMessages) || 0)),
    remainingMessages: Math.max(0, Math.floor(Number(event.remainingMessages) || 0)),
    summaryChars: Math.max(0, Math.floor(Number(event.summaryChars) || 0)),
    estimatedTokens: counter(event.estimatedTokens, MAX_TOKEN_COUNT),
    contextWindow: counter(event.contextWindow, MAX_TOKEN_COUNT),
  }
  entry.compactions = [...(entry.compactions || []), compaction].slice(-MAX_COMPACTIONS_PER_RUN)
  entry.updatedAt = compaction.at
  persistState(state)
}

/**
 * Record that a run's knowledge digest was written to the project.
 *
 * Called only with a real write result; there is no path that records a sink
 * from an intention or from a model's own account of what it did.
 */
export function recordRunMemorySink(runId: string, input: { path: string; bytes: number }): void {
  if (!runId || !input?.path) return
  const state = loadState()
  const entry = state.entries.find((item) => item.kind === 'run' && item.id === runId)
  if (!entry) return
  entry.memorySink = {
    at: now(),
    path: bounded(input.path, 400) || input.path.slice(0, 400),
    bytes: Math.max(0, Math.floor(Number(input.bytes) || 0)),
  }
  entry.updatedAt = entry.memorySink.at
  persistState(state)
}

export function markRunDelivered(runId: string): void {
  const state = loadState()
  const entry = state.entries.find((item) => item.kind === 'run' && item.id === runId)
  if (!entry || entry.delivery !== 'pending-delivery') return
  entry.delivery = 'delivered'
  entry.updatedAt = now()
  persistState(state)
}

/**
 * Claim every terminal run outcome the user was never told about.
 *
 * Claiming marks each entry `consumed` in the same pass that returns it, so a
 * repeated startup — or a second caller — can never narrate the same
 * completion twice.
 */
export function claimPendingRunDeliveries(): JournalEntry[] {
  const state = loadState()
  const claimed: JournalEntry[] = []
  for (const entry of state.entries) {
    if (entry.kind !== 'run' || entry.delivery !== 'pending-delivery') continue
    if (['queued', 'dispatching', 'admitted', 'running'].includes(entry.status)) continue
    claimed.push({ ...entry })
    entry.delivery = 'consumed'
    entry.updatedAt = now()
  }
  if (claimed.length) persistState(state)
  return claimed
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

/** Read-only evaluation/Ops projection; unlike consumeRecoveryReports it does not mark state delivered. */
export function listJournalEntries(preferred?: Storage): JournalEntry[] {
  const state = loadState(preferred)
  return state.entries.map((entry) => ({ ...entry }))
}

/** Read recovery reports without changing delivery state. */
export function listRecoveryReports(preferred?: Storage): RecoveryReport[] {
  const store = storage(preferred)
  if (!store) return []
  try {
    const value = JSON.parse(store.getItem(REPORT_KEY) || '[]')
    return Array.isArray(value)
      ? value.map((report) => ({
          ...report,
          items: Array.isArray(report?.items) ? report.items.map((item: RecoveryItem) => ({ ...item })) : [],
        }))
      : []
  } catch {
    return []
  }
}

/**
 * Mark uncertain in-flight work interrupted; never replay an uncertain side
 * effect. When Host truth is supplied, active/terminal Pi attachments are
 * preserved and consumed by the coordinator recovery path instead.
 *
 * Without Host truth (plain browser or a missing bridge), the historical
 * fail-safe remains: renderer-owned in-flight work is honestly interrupted.
 */
export function reconcileStartup(hostTruth?: StartupHostTruth): RecoveryReport | null {
  const state = loadState()
  const active = new Set<JournalStatus>(['admitted', 'running', 'dispatching'])
  const items: RecoveryItem[] = []
  for (const entry of state.entries) {
    if (!active.has(entry.status)) continue
    if (entry.kind === 'run' && hostTruth) {
      const runId = entry.runId || entry.id
      if (hostTruth.activeRunIds.has(runId)) continue
      if (hostTruth.terminalRunIds.has(runId)) continue
    }
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
