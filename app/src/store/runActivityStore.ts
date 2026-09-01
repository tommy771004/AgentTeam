/**
 * Live run activity for Codex-style center feed (thought / tools / draft text / files).
 * Ephemeral — not persisted in thread bubbles.
 */

import { create } from 'zustand'
import {
  phaseFromStatusLine,
  type RunLifecyclePhase,
} from '../agent/runLifecycle.ts'
import type {
  ExternalCliRunPhase,
  ExternalCliTerminalClassification,
} from '../agent/externalCliRunSession.ts'
import type { TurnRecordEntry } from '../agent/turnRecord.ts'
import { TURN_RECORD_FORMAT_VERSION } from '../agent/turnRecord.ts'
import { projectRunFileChanges } from '../agent/runOperationsProjection.ts'

export type RunActivityKind =
  | 'status'
  | 'thought'
  | 'text'
  | 'tool'
  | 'file'
  | 'log'
  | 'error'
  | 'done'
  /**
   * Earlier conversation was summarised away to stay inside the context
   * window. It is its own kind because the user has to be able to see that it
   * happened — an agent that silently forgot is indistinguishable from one
   * that is making things up.
   */
  | 'compaction'

/** Compatibility name; the lifecycle vocabulary is shared by every UI surface. */
export type RunActivityPhase = RunLifecyclePhase
export type RunActivityEvent = {
  id: string
  at: number
  /** Run identity used to keep concurrent streams isolated. */
  runId?: string
  kind: RunActivityKind
  title?: string
  detail?: string
  tool?: string
  /** Stable Pi/CLI tool-call identity so start/result rows count as one call. */
  callId?: string
  ok?: boolean
  /** File path when kind=file */
  path?: string
  added?: number
  removed?: number
}

export type FileChangeRecord = {
  path: string
  action: 'edit' | 'create' | 'delete' | 'write' | 'read'
  added?: number
  removed?: number
  at: number
}

export type RunTaskStatus = 'pending' | 'active' | 'done' | 'failed'

export type RunTaskDetail = {
  label: string
  meta?: string
}

export type RunTaskSnapshotItem = {
  id?: string
  text: string
  status?: string
  /** Short, Agent-authored value shown on the row (for example "2 files"). */
  meta?: string
  /** Bounded Agent-authored child steps. Never synthesized from prompt/history. */
  details?: RunTaskDetail[]
}

/** 分析出的須執行任務項（TodoWrite / update_plan / checkbox 解析）→ 右側面板即時同步 */
export type RunTaskItem = {
  id: string
  text: string
  status: RunTaskStatus
  at: number
  meta?: string
  details?: RunTaskDetail[]
}

/**
 * How a run actually settled, recorded once when it leaves the live path.
 *
 * The shell reads this to announce a completion, so there is no second store
 * tracking which runs have finished.
 */
export type RunTerminalOutcome = {
  status: 'success' | 'failed' | 'halted'
  objective?: string
  executionKind?: 'loop' | 'external'
  iterations?: number
  maxIterations?: number
  dodMet?: boolean
  /** Set when the run was parked; seals the draft and names the reason. */
  interruptReason?: 'user' | 'timeout'
}

/**
 * Closing mark for a reply that was cut off mid-sentence.
 *
 * The partial text is real output and stays, but it must never read as a
 * finished answer — the seal is what tells the user where the agent stopped.
 */
export const INTERRUPTED_DRAFT_SEAL = {
  user: '\n\n⌁ 已在此中止（你按下停止）',
  timeout: '\n\n⌁ 已在此中止（逾時）',
} as const

export function sealInterruptedDraft(draft: string, reason: 'user' | 'timeout'): string {
  const seal = INTERRUPTED_DRAFT_SEAL[reason]
  if (!draft.trim()) return draft
  return draft.endsWith(seal) ? draft : `${draft.trimEnd()}${seal}`
}

export type TerminalRunDigest = {
  runId: string
  finishedAt: number
  statusLine: string
  /** Absent when a run was terminalized without a coordinator settlement. */
  outcome?: RunTerminalOutcome
  events: RunActivityEvent[]
  thought: string
  draftText: string
  fileChanges: FileChangeRecord[]
  tasks: RunTaskItem[]
  phase: RunActivityPhase
}

/** Renderer-safe recovery projection; no objective, prompt, or credentials. */
export type ExternalCliRecoveryProjection = {
  runId: string
  conversationId?: string
  adapter: string
  interruptedAt: number
  reason: string
  resumable: boolean
  automaticRetry: boolean
  providerSessionId?: string
}

export type ExternalCliInteractionProjection = {
  kind: 'user' | 'approval'
  detail?: string
  providerSessionId?: string
}

/** One run's isolated live presentation or bounded terminal digest. */
export type RunPresentation = {
  runId: string
  /** Conversation that owns this run; stamped at begin() so a completion can be routed. */
  threadId?: string
  active: boolean
  startedAt: number
  updatedAt: number
  events: RunActivityEvent[]
  thought: string
  draftText: string
  statusLine: string
  fileChanges: FileChangeRecord[]
  tasks: RunTaskItem[]
  phase: RunActivityPhase
  /**
   * Turn Record entries this run has published so far, in recorded order.
   *
   * Still ephemeral — the Host's record remains the durable account, and this
   * is only what the renderer has watched arrive. It exists so the live
   * timeline can be projected from the record instead of synthesised from the
   * activity stream, which is what makes live and replay agree on order.
   */
  recordEntries: TurnRecordEntry[]
  /**
   * How many entries the run has published, including any the buffer above
   * has already dropped. Kept so the view can say an older prefix exists
   * rather than presenting a trimmed buffer as the whole run.
   */
  recordTotal: number
  /** Host attachment bootstrap is in progress; this is transport state, not run failure. */
  reattaching: boolean
  /** Retention omitted an older prefix during Host attachment. */
  reattachGap: { missingBefore: number; earliestSeq: number } | null
  /**
   * The user has asked this run to stop and the Host has not settled yet.
   * Drives immediate feedback so the button answers the press, not the Host.
   */
  stopping: boolean
  terminal: TerminalRunDigest | null
  recovery: ExternalCliRecoveryProjection | null
  interaction: ExternalCliInteractionProjection | null
  /** Current Host-authored connector authentication blocker. */
  authenticationRequired: boolean
}

/** IPC payload from main → renderer during CLI stream */
export type CliStreamPayload = {
  runId?: string
  kind: RunActivityKind | 'chunk' | 'plan'
  title?: string
  detail?: string
  tool?: string
  callId?: string
  ok?: boolean
  delta?: string
  channel?: 'thought' | 'text' | 'stdout' | 'stderr'
  path?: string
  paths?: string[]
  added?: number
  removed?: number
  action?: FileChangeRecord['action']
  /** kind=plan：完整任務清單快照 */
  todos?: RunTaskSnapshotItem[]
  sequence?: number
  sessionPhase?: ExternalCliRunPhase
  terminalClassification?: ExternalCliTerminalClassification
  providerSessionId?: string
  authenticationRequired?: boolean
}

export interface RunActivityStore {
  runId: string | null
  active: boolean
  events: RunActivityEvent[]
  thought: string
  draftText: string
  statusLine: string
  phase: RunActivityPhase
  /** Unique file edits for final Codex-style summary card */
  fileChanges: FileChangeRecord[]
  /** 分析出的須執行任務項 — 右側面板即時同步 */
  tasks: RunTaskItem[]
  /** Run-scoped source of truth; flat fields above are a selected-run projection. */
  presentations: Record<string, RunPresentation>

  begin: (runId?: string, threadId?: string) => void
  /** Immediate stop acknowledgement, before the Host reaches a tool boundary. */
  markStopping: (runId: string, statusLine?: string) => void
  end: (runId?: string, statusLine?: string, outcome?: RunTerminalOutcome) => void
  clear: (runId?: string) => void
  selectRun: (runId?: string | null) => void
  getPresentation: (runId?: string | null) => RunPresentation | null
  push: (ev: Omit<RunActivityEvent, 'id' | 'at'> & { id?: string }) => void
  appendThought: (delta: string, runId?: string) => void
  appendText: (delta: string, runId?: string) => void
  /** Entries the Host just wrote to the running turn's record, in order. */
  appendRecordEntries: (entries: readonly TurnRecordEntry[], runId?: string) => void
  /** Install a Host snapshot without treating backfilled entries as new events. */
  reattachRecord: (input: {
    entries: readonly TurnRecordEntry[]
    total: number
    latestSeq: number
    gap?: { missingBefore: number; earliestSeq: number }
  }, runId: string) => void
  setReattaching: (reattaching: boolean, runId: string, statusLine?: string) => void
  setStatus: (line: string, runId?: string, phase?: RunActivityPhase) => void
  setRecovery: (recovery: ExternalCliRecoveryProjection, runId?: string) => void
  setInteraction: (interaction: ExternalCliInteractionProjection | null, runId?: string) => void
  setAuthenticationRequired: (required: boolean, runId?: string) => void
  recordFileChange: (f: Omit<FileChangeRecord, 'at'> & { at?: number }, runId?: string) => void
  /** 以完整快照取代任務清單（結構化 plan 事件） */
  setTasks: (todos: RunTaskSnapshotItem[], runId?: string) => void
  /** 文字流 checkbox 解析 → 新增或更新單項 */
  upsertTask: (text: string, status: RunTaskStatus, runId?: string) => void
  clearDraft: (runId?: string) => void
  handleCliStream: (payload: CliStreamPayload) => void
}

function syncAuthenticationRequirement(
  store: RunActivityStore,
  payload: CliStreamPayload,
  runId: string,
): void {
  if (payload.authenticationRequired !== undefined) {
    store.setAuthenticationRequired(payload.authenticationRequired, runId)
  } else if (payload.kind === 'status' && payload.sessionPhase === 'running') {
    store.setAuthenticationRequired(false, runId)
  }
}

let seq = 0
function nid(prefix = 'ra') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}

const MAX_EVENTS = 120
/**
 * Live record entries one run keeps in the renderer.
 *
 * Bounded because this store is ephemeral presentation, not storage — the
 * complete record lives in the Host and is read a page at a time. Dropping the
 * oldest is safe precisely because `recordTotal` keeps counting, so the view
 * knows a prefix exists and can ask the Host for it.
 */
const MAX_RECORD_ENTRIES = 400
const MAX_THOUGHT = 12_000
const MAX_DRAFT = 40_000
const MAX_FILES = 80
const MAX_TASKS = 40
export const MAX_PRESENTATIONS = 100
const MAX_TERMINAL_EVENTS = 40
const MAX_TERMINAL_THOUGHT = 2_000
const MAX_TERMINAL_DRAFT = 8_000
const MAX_TERMINAL_FILES = 40
const MAX_TERMINAL_TASKS = 40

type RunActivityProjection = Pick<
  RunActivityStore,
  | 'runId'
  | 'active'
  | 'events'
  | 'thought'
  | 'draftText'
  | 'statusLine'
  | 'fileChanges'
  | 'tasks'
  | 'phase'
>

function emptyPresentation(runId: string, now = Date.now()): RunPresentation {
  return {
    runId,
    active: false,
    startedAt: now,
    updatedAt: now,
    events: [],
    thought: '',
    draftText: '',
    statusLine: '',
    fileChanges: [],
    tasks: [],
    phase: 'starting',
    recordEntries: [],
    recordTotal: 0,
    reattaching: false,
    reattachGap: null,
    stopping: false,
    terminal: null,
    recovery: null,
    interaction: null,
    authenticationRequired: false,
  }
}

function projectPresentation(p: RunPresentation | undefined): RunActivityProjection {
  return {
    runId: p?.runId || null,
    active: p?.active || false,
    events: p?.events || [],
    thought: p?.thought || '',
    draftText: p?.draftText || '',
    statusLine: p?.statusLine || '',
    fileChanges: p?.fileChanges || [],
    tasks: p?.tasks || [],
    phase: p?.phase || 'starting',
  }
}

function clonePresentation(p: RunPresentation): RunPresentation {
  return {
    ...p,
    events: [...p.events],
    fileChanges: [...p.fileChanges],
    tasks: [...p.tasks],
    recordEntries: [...p.recordEntries],
    terminal: p.terminal
      ? {
          ...p.terminal,
          outcome: p.terminal.outcome ? { ...p.terminal.outcome } : undefined,
          events: [...p.terminal.events],
          fileChanges: [...p.terminal.fileChanges],
          tasks: [...p.terminal.tasks],
        }
      : null,
    recovery: p.recovery ? { ...p.recovery } : null,
    interaction: p.interaction ? { ...p.interaction } : null,
  }
}

function trimPresentations(
  presentations: Record<string, RunPresentation>,
  selectedRunId: string | null,
) {
  const ids = Object.keys(presentations)
  if (ids.length <= MAX_PRESENTATIONS) return presentations

  const evictable = ids
    .filter((id) => id !== selectedRunId && !presentations[id].active)
    .sort((a, b) => {
      const left = presentations[a].terminal?.finishedAt || presentations[a].updatedAt
      const right = presentations[b].terminal?.finishedAt || presentations[b].updatedAt
      return left - right
    })
  const next = { ...presentations }
  for (const id of evictable) {
    if (Object.keys(next).length <= MAX_PRESENTATIONS) break
    delete next[id]
  }
  return next
}

function applyRunUpdate(
  state: Pick<RunActivityStore, 'presentations' | 'runId'>,
  runId: string,
  update: (presentation: RunPresentation) => RunPresentation,
) {
  const current = state.presentations[runId] || emptyPresentation(runId)
  // Once a run has a terminal digest, late stream events must not reopen or
  // mutate it. A new begin(runId) explicitly starts a fresh presentation.
  if (current.terminal && !current.active) {
    return {
      presentations: state.presentations,
      ...projectPresentation(state.runId ? state.presentations[state.runId] : undefined),
    }
  }
  const nextPresentation = update(current)
  const presentations = trimPresentations(
    { ...state.presentations, [runId]: nextPresentation },
    state.runId,
  )
  const selected = state.runId === runId ? nextPresentation : presentations[state.runId || '']
  return { presentations, ...projectPresentation(selected) }
}

function terminalizePresentation(
  presentation: RunPresentation,
  statusLine: string | undefined,
  finishedAt: number,
  outcome?: RunTerminalOutcome,
): RunPresentation {
  const phase = terminalPhase(statusLine || presentation.statusLine)
  // A parked run keeps the partial reply it already streamed, sealed so it
  // cannot be mistaken for a completed answer.
  const draftText = outcome?.interruptReason
    ? sealInterruptedDraft(presentation.draftText, outcome.interruptReason)
    : presentation.draftText
  const digest: TerminalRunDigest = {
    runId: presentation.runId,
    finishedAt,
    statusLine: (statusLine || presentation.statusLine || '完成').slice(0, 200),
    outcome: outcome ? { ...outcome, objective: outcome.objective?.slice(0, 200) } : undefined,
    events: presentation.events.slice(-MAX_TERMINAL_EVENTS),
    thought: presentation.thought.slice(-MAX_TERMINAL_THOUGHT),
    draftText: draftText.slice(-MAX_TERMINAL_DRAFT),
    fileChanges: presentation.fileChanges.slice(-MAX_TERMINAL_FILES),
    tasks: presentation.tasks.slice(-MAX_TERMINAL_TASKS),
    phase,
  }
  return {
    ...presentation,
    active: false,
    stopping: false,
    updatedAt: finishedAt,
    statusLine: digest.statusLine,
    events: digest.events,
    thought: digest.thought,
    draftText: digest.draftText,
    fileChanges: digest.fileChanges,
    tasks: digest.tasks,
    phase,
    terminal: digest,
    authenticationRequired: false,
  }
}

function phaseFromStatus(line: string, fallback: RunActivityPhase): RunActivityPhase {
  return phaseFromStatusLine(line, fallback)
}

function phaseFromEvent(
  kind: RunActivityKind,
  label: string,
  fallback: RunActivityPhase,
): RunActivityPhase {
  if (kind === 'error') return 'failed'
  if (kind === 'done') return 'finalizing'
  if (kind === 'thought') return 'thinking'
  if (kind === 'text') return 'responding'
  if (kind === 'tool' || kind === 'file') return 'executing'
  // Compaction is housekeeping between rounds; it must not move the phase and
  // make the run look like it changed what it was doing.
  if (kind === 'compaction') return fallback
  if (kind === 'status') return phaseFromStatus(label, fallback)
  return fallback
}

function terminalPhase(line: string): RunActivityPhase {
  const value = line.toLowerCase()
  if (/已停止|取消|cancel|interrupt|halt/.test(value)) return 'cancelled'
  if (/失敗|錯誤|error|fail/.test(value)) return 'failed'
  return 'completed'
}

function basen(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p
}

function normalizeTaskStatus(raw?: string): RunTaskStatus {
  const s = (raw || '').toLowerCase()
  if (s.includes('done') || s.includes('complete')) return 'done'
  if (s.includes('progress') || s.includes('active')) return 'active'
  if (s.includes('fail') || s.includes('error')) return 'failed'
  return 'pending'
}

function taskKey(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeTaskDetails(details: RunTaskDetail[] | undefined): RunTaskDetail[] | undefined {
  if (!Array.isArray(details)) return undefined
  const normalized = details.slice(0, 8).flatMap((detail) => {
    const label = String(detail?.label || '').trim().slice(0, 200)
    if (!label) return []
    const meta = String(detail.meta || '').trim().slice(0, 80)
    return [{ label, ...(meta ? { meta } : {}) }]
  })
  return normalized.length ? normalized : undefined
}

/** 逐行掃描文字流的 markdown checkbox（- [ ] / - [x]），每個 run 各自保留尾端 buffer。 */
const taskLineBuf = new Map<string, Record<'thought' | 'text', string>>()
const FALLBACK_RUN_ID = '__selected__'

function resetTaskLineBuf(runId?: string) {
  if (runId) {
    taskLineBuf.delete(runId)
    return
  }
  taskLineBuf.clear()
}

function scanTaskLines(
  runId: string | undefined,
  channel: 'thought' | 'text',
  delta: string,
  upsert: (text: string, status: RunTaskStatus) => void,
) {
  const key = runId || FALLBACK_RUN_ID
  const buffer = taskLineBuf.get(key) || { thought: '', text: '' }
  buffer[channel] = (buffer[channel] + delta).slice(-4000)
  const parts = buffer[channel].split('\n')
  buffer[channel] = parts.pop() || ''
  taskLineBuf.set(key, buffer)
  for (const raw of parts) {
    const m = raw.trim().match(/^[-*]\s*\[([ xX])\]\s+(.+)$/)
    if (m?.[2]?.trim()) {
      upsert(m[2].trim().slice(0, 200), m[1] === ' ' ? 'pending' : 'done')
    }
  }
}

export const useRunActivityStore = create<RunActivityStore>((set, get) => ({
  runId: null,
  active: false,
  events: [],
  thought: '',
  draftText: '',
  statusLine: '',
  phase: 'starting',
  fileChanges: [],
  tasks: [],
  presentations: {},

  begin: (runId, threadId) => {
    const target = runId || nid('run')
    const now = Date.now()
    resetTaskLineBuf(target)
    set((s) => {
      const existing = s.presentations[target]
      // Adapters may defensively call begin after the coordinator has already
      // admitted the run. Keep the same presentation so early activity is not
      // erased when the runner takes over.
      if (existing?.active && !existing.terminal) {
        const selected = s.runId ? s.presentations[s.runId] : existing
        return { presentations: s.presentations, ...projectPresentation(selected) }
      }
      const presentation: RunPresentation = {
        ...emptyPresentation(target, now),
        threadId: threadId || existing?.threadId,
        active: true,
        statusLine: '啟動中…',
      }
      const presentations = trimPresentations(
        { ...s.presentations, [target]: presentation },
        s.runId || target,
      )
      // Starting a background run must not steal the visible feed from the
      // thread the user selected. The first run still becomes selected when
      // there is no existing selection.
      const selected = s.runId ? presentations[s.runId] : presentation
      return { presentations, ...projectPresentation(selected) }
    })
  },

  markStopping: (runId, statusLine) => {
    if (!runId) return
    set((s) => {
      const current = s.presentations[runId]
      if (!current || current.terminal || current.stopping) return s
      const stopped: RunPresentation = {
        ...current,
        stopping: true,
        // Formal park phase (hermes CANCEL_REQUESTED): a requested stop is its
        // own live state until the Host settles, not a reworded executing.
        phase: 'cancel_requested',
        updatedAt: Date.now(),
        statusLine: statusLine || '正在安全停車…',
      }
      const presentations = { ...s.presentations, [runId]: stopped }
      const selected = s.runId === runId ? stopped : presentations[s.runId || '']
      return { presentations, ...projectPresentation(selected) }
    })
  },

  end: (runId, statusLine, outcome) => {
    const target = runId || get().runId
    if (!target) return
    resetTaskLineBuf(target)
    set((s) => {
      const current = s.presentations[target]
      if (!current || (current.terminal && !current.active)) return s
      const completed = terminalizePresentation(current, statusLine, Date.now(), outcome)
      const presentations = trimPresentations({ ...s.presentations, [target]: completed }, s.runId)
      const selected = s.runId === target ? completed : presentations[s.runId || '']
      return { presentations, ...projectPresentation(selected) }
    })
  },

  clear: (runId) => {
    resetTaskLineBuf(runId)
    set((s) => {
      if (!runId) return { presentations: {}, ...projectPresentation(undefined) }
      const presentations = { ...s.presentations }
      delete presentations[runId]
      const selectedRunId = s.runId === runId ? null : s.runId
      return {
        presentations,
        ...projectPresentation(selectedRunId ? presentations[selectedRunId] : undefined),
      }
    })
  },

  selectRun: (runId) => {
    set((s) => {
      const selectedRunId = runId && s.presentations[runId] ? runId : null
      return {
        ...projectPresentation(selectedRunId ? s.presentations[selectedRunId] : undefined),
      }
    })
  },

  getPresentation: (runId) => {
    const target = runId || get().runId
    const presentation = target ? get().presentations[target] : undefined
    return presentation ? clonePresentation(presentation) : null
  },

  push: (ev) => {
    const current = get()
    const target = ev.runId || current.runId
    if (!target) return
    const item: RunActivityEvent = {
      id: ev.id || nid(),
      at: Date.now(),
      runId: target,
      kind: ev.kind,
      title: ev.title,
      detail: ev.detail?.slice(0, 2000),
      tool: ev.tool,
      callId: ev.callId,
      ok: ev.ok,
      path: ev.path,
      added: ev.added,
      removed: ev.removed,
    }
    set((s) =>
      applyRunUpdate(s, target, (presentation) => ({
        ...presentation,
        updatedAt: item.at,
        events: [...presentation.events, item].slice(-MAX_EVENTS),
        phase: phaseFromEvent(
          ev.kind,
          `${ev.title || ''} ${ev.detail || ''}`,
          presentation.phase,
        ),
        statusLine:
          ev.kind === 'status' || ev.kind === 'tool' || ev.kind === 'file' || ev.kind === 'error'
            ? (ev.title || ev.detail || presentation.statusLine).slice(0, 200)
            : presentation.statusLine,
      })),
    )
  },

  appendThought: (delta, runId) => {
    if (!delta) return
    const target = runId || get().runId
    if (!target) return
    set((s) =>
      applyRunUpdate(s, target, (presentation) => ({
        ...presentation,
        thought: (presentation.thought + delta).slice(-MAX_THOUGHT),
        updatedAt: Date.now(),
        active: true,
        phase: 'thinking',
      })),
    )
  },

  appendText: (delta, runId) => {
    if (!delta) return
    const target = runId || get().runId
    if (!target) return
    set((s) =>
      applyRunUpdate(s, target, (presentation) => ({
        ...presentation,
        draftText: (presentation.draftText + delta).slice(-MAX_DRAFT),
        updatedAt: Date.now(),
        active: true,
        phase: 'responding',
      })),
    )
  },

  appendRecordEntries: (entries, runId) => {
    if (!entries.length) return
    const target = runId || get().runId
    if (!target) return
    set((s) =>
      applyRunUpdate(s, target, (presentation) => {
        // Dedupe by seq rather than by arrival: a reconnect or a replayed
        // frame must not be able to put the same entry on the timeline twice.
        const known = new Set(presentation.recordEntries.map((entry) => entry.seq))
        const added = entries.filter((entry) => !known.has(entry.seq))
        if (!added.length) return presentation
        const merged = [...presentation.recordEntries, ...added].sort((left, right) => left.seq - right.seq)
        const addedResultSeqs = new Set(
          added.filter((entry) => entry.kind === 'tool-result' && entry.settlement === 'success').map((entry) => entry.seq),
        )
        const newFileChanges = addedResultSeqs.size > 0
          ? projectRunFileChanges(
              { version: TURN_RECORD_FORMAT_VERSION, entries: merged },
              addedResultSeqs,
            )
          : []
        const fileChanges = [...presentation.fileChanges]
        for (const change of newFileChanges) {
          const existingIndex = fileChanges.findIndex((file) => file.path === change.path)
          const current = existingIndex >= 0 ? fileChanges[existingIndex] : undefined
          const next: FileChangeRecord = {
            path: change.path,
            action: current?.action === 'create' || change.action === 'create' ? 'create' : 'edit',
            added: (current?.added ?? 0) + change.added,
            removed: (current?.removed ?? 0) + change.removed,
            at: Date.now(),
          }
          if (existingIndex >= 0) fileChanges[existingIndex] = next
          else fileChanges.push(next)
        }
        // The message the draft was accumulating is now ON the record, so the
        // draft has done its job. Keeping it would put the same sentence on the
        // timeline twice — once as the recorded assistant row and once as the
        // line still being written — and would weld the next message onto it.
        const recorded = added.some((entry) => entry.kind === 'assistant-text')
        return {
          ...presentation,
          recordEntries: merged.slice(-MAX_RECORD_ENTRIES),
          fileChanges: fileChanges.slice(-MAX_FILES),
          // `recordTotal` is a Host high-watermark/count, not a count of this
          // renderer's arrivals. A replayed/backfilled page must not inflate it.
          recordTotal: Math.max(presentation.recordTotal, merged.length, merged.at(-1)?.seq || 0),
          ...(recorded ? { draftText: '' } : {}),
          updatedAt: Date.now(),
          active: true,
        }
      }),
    )
  },

  reattachRecord: (input, runId) => {
    if (!runId) return
    set((s) =>
      applyRunUpdate(s, runId, (presentation) => {
        const bySeq = new Map<number, TurnRecordEntry>()
        for (const entry of presentation.recordEntries) bySeq.set(entry.seq, entry)
        for (const entry of input.entries) bySeq.set(entry.seq, entry)
        const recordEntries = [...bySeq.values()].sort((left, right) => left.seq - right.seq).slice(-MAX_RECORD_ENTRIES)
        const fileChanges = [...presentation.fileChanges]
        for (const change of projectRunFileChanges({ version: TURN_RECORD_FORMAT_VERSION, entries: recordEntries })) {
          const existingIndex = fileChanges.findIndex((file) => file.path === change.path)
          const current = existingIndex >= 0 ? fileChanges[existingIndex] : undefined
          const next: FileChangeRecord = {
            path: change.path,
            action: current?.action === 'create' || change.action === 'create' ? 'create' : 'edit',
            added: Math.max(current?.added ?? 0, change.added),
            removed: Math.max(current?.removed ?? 0, change.removed),
            at: Date.now(),
          }
          if (existingIndex >= 0) fileChanges[existingIndex] = next
          else fileChanges.push(next)
        }
        return {
          ...presentation,
          recordEntries,
          fileChanges: fileChanges.slice(-MAX_FILES),
          // The Host's total/latestSeq are authoritative and monotonic; the
          // renderer never derives a larger count from replay arrivals.
          recordTotal: Math.max(presentation.recordTotal, input.total, input.latestSeq, recordEntries.length),
          reattachGap: input.gap || presentation.reattachGap,
          reattaching: false,
          statusLine: presentation.statusLine === '正在重新附著…' ? 'Pi Core Host 執行中…' : presentation.statusLine,
          updatedAt: Date.now(),
          active: true,
        }
      }),
    )
  },

  setReattaching: (reattaching, runId, statusLine) => {
    if (!runId) return
    set((s) => {
      const current = s.presentations[runId] || emptyPresentation(runId)
      const next = {
        ...current,
        reattaching,
        statusLine: statusLine || (reattaching ? '正在重新附著…' : current.statusLine),
        updatedAt: Date.now(),
        ...(reattaching ? { active: true, phase: 'starting' as const } : {}),
      }
      const presentations = { ...s.presentations, [runId]: next }
      const selected = s.runId === runId ? next : presentations[s.runId || '']
      return { presentations, ...projectPresentation(selected) }
    })
  },

  setStatus: (line, runId, phase) => {
    const target = runId || get().runId
    if (!target) return
    const statusLine = line.slice(0, 200)
    set((s) =>
      applyRunUpdate(s, target, (presentation) => ({
        ...presentation,
        statusLine,
        updatedAt: Date.now(),
        // A structured phase from the Host wins; the status-line regex is
        // only a fallback for adapters that carry no structured signal.
        phase: phase ?? phaseFromStatus(statusLine, presentation.phase),
      })),
    )
  },

  setRecovery: (recovery, runId) => {
    const target = runId || recovery.runId || get().runId
    if (!target) return
    set((s) =>
      applyRunUpdate(s, target, (presentation) => ({
        ...presentation,
        active: true,
        recovery: { ...recovery, runId: target, reason: recovery.reason.slice(0, 300) },
        statusLine: 'CLI 已中斷，需要手動重新執行',
        updatedAt: Date.now(),
        phase: 'manual_intervention',
      })),
    )
  },

  setInteraction: (interaction, runId) => {
    const target = runId || get().runId
    if (!target) return
    set((s) =>
      applyRunUpdate(s, target, (presentation) => ({
        ...presentation,
        interaction: interaction
          ? { ...interaction, detail: interaction.detail?.slice(0, 400) }
          : null,
        updatedAt: Date.now(),
      })),
    )
  },

  setAuthenticationRequired: (required, runId) => {
    const target = runId || get().runId
    if (!target) return
    set((s) => applyRunUpdate(s, target, (presentation) => ({
      ...presentation,
      authenticationRequired: required,
      updatedAt: Date.now(),
    })))
  },

  setTasks: (todos, runId) => {
    const target = runId || get().runId
    if (!target) return
    const now = Date.now()
    const seen = new Set<string>()
    const source = get().presentations[target] || emptyPresentation(target)
    const tasks: RunTaskItem[] = []
    for (const t of todos.slice(0, MAX_TASKS)) {
      const text = (t.text || '').trim()
      if (!text) continue
      const key = taskKey(text)
      if (seen.has(key)) continue
      seen.add(key)
      const suppliedId = String(t.id || '').trim().slice(0, 80)
      const prev = source.tasks.find((x) => (suppliedId && x.id === suppliedId) || taskKey(x.text) === key)
      const meta = String(t.meta || '').trim().slice(0, 80)
      const details = normalizeTaskDetails(t.details)
      tasks.push({
        id: suppliedId || prev?.id || nid('task'),
        text: text.slice(0, 200),
        status: normalizeTaskStatus(t.status),
        at: prev?.at || now,
        ...(meta ? { meta } : {}),
        ...(details ? { details } : {}),
      })
    }
    if (tasks.length) {
      set((s) =>
        applyRunUpdate(s, target, (presentation) => ({
          ...presentation,
          tasks,
          updatedAt: now,
          phase: 'planning',
        })),
      )
      // Persist the latest snapshot on the run's thread. The explicit runId
      // prevents a late concurrent stream from writing into another thread.
      if (typeof window !== 'undefined') {
        void import('./threadStore.ts').then(({ useThreadStore }) => {
          const threadState = useThreadStore.getState()
          const threadId = threadState.threads.find(
            (thread) => threadState.runningRunIds[thread.id] === target,
          )?.id
          if (threadId) useThreadStore.getState().setRunPlan(threadId, tasks)
        })
      }
    }
  },

  upsertTask: (text, status, runId) => {
    const clean = text.trim()
    const target = runId || get().runId
    if (!clean || !target) return
    const key = taskKey(clean)
    set((s) =>
      applyRunUpdate(s, target, (presentation) => {
        const idx = presentation.tasks.findIndex((x) => taskKey(x.text) === key)
        if (idx >= 0) {
          if (presentation.tasks[idx].status === status) return presentation
          const tasks = [...presentation.tasks]
          tasks[idx] = { ...tasks[idx], status, at: Date.now() }
          return { ...presentation, tasks, updatedAt: Date.now() }
        }
        if (presentation.tasks.length >= MAX_TASKS) return presentation
        return {
          ...presentation,
          updatedAt: Date.now(),
          tasks: [
            ...presentation.tasks,
            { id: nid('task'), text: clean.slice(0, 200), status, at: Date.now() },
          ],
        }
      }),
    )
  },

  recordFileChange: (f, runId) => {
    const path = (f.path || '').trim()
    const target = runId || get().runId
    if (!path || !target) return
    set((s) =>
      applyRunUpdate(s, target, (presentation) => {
        const prev = presentation.fileChanges.findIndex((x) => x.path === path)
        const next: FileChangeRecord = {
          path,
          action: f.action || 'edit',
          added: f.added,
          removed: f.removed,
          at: f.at || Date.now(),
        }
        let list: FileChangeRecord[]
        if (prev >= 0) {
          list = [...presentation.fileChanges]
          const old = list[prev]
          list[prev] = {
            ...old,
            ...next,
            added: f.added ?? old.added,
            removed: f.removed ?? old.removed,
            action: f.action || old.action,
          }
        } else {
          list = [...presentation.fileChanges, next].slice(-MAX_FILES)
        }
        return { ...presentation, fileChanges: list, updatedAt: Date.now() }
      }),
    )
  },

  clearDraft: (runId) => {
    const target = runId || get().runId
    if (!target) return
    set((s) =>
      applyRunUpdate(s, target, (presentation) => ({
        ...presentation,
        draftText: '',
        updatedAt: Date.now(),
      })),
    )
  },

  handleCliStream: (payload) => {
    const s = get()
    // A tagged stream always routes to its own presentation. Untagged legacy
    // streams may use the selected run, but can never overwrite another run's
    // record once a run identity is available.
    const streamRunId = payload.runId || s.runId || undefined
    if (!streamRunId) return
    const existing = s.presentations[streamRunId]
    if (existing?.terminal && !existing.active) return

    syncAuthenticationRequirement(get(), payload, streamRunId)

    if (payload.sessionPhase === 'waiting_for_user' || payload.sessionPhase === 'waiting_for_approval') {
      get().setInteraction({
        kind: payload.sessionPhase === 'waiting_for_user' ? 'user' : 'approval',
        detail: payload.detail || payload.title,
        providerSessionId: payload.providerSessionId,
      }, streamRunId)
    } else if (payload.kind === 'status' && payload.sessionPhase === 'running') {
      get().setInteraction(null, streamRunId)
    }

    // 結構化任務清單（TodoWrite / update_plan / todo_list）→ 完整快照取代
    if (payload.kind === 'plan') {
      if (payload.todos?.length) {
        get().setTasks(payload.todos, streamRunId)
        get().push({
          kind: 'status',
          runId: streamRunId,
          title: payload.title || '任務清單更新',
          detail: `${payload.todos.length} 項`,
        })
      }
      return
    }

    if (payload.channel === 'thought' || payload.kind === 'thought') {
      const delta = payload.delta || payload.detail || ''
      if (delta) {
        const presentation = get().presentations[streamRunId]
        if (!presentation?.thought) {
          get().push({ kind: 'status', runId: streamRunId, title: '開始思考' })
          get().setStatus('思考中…', streamRunId)
        }
        get().appendThought(delta, streamRunId)
        scanTaskLines(streamRunId, 'thought', delta, (text, status) =>
          get().upsertTask(text, status, streamRunId),
        )
      }
      return
    }
    if (payload.channel === 'text' || payload.kind === 'text') {
      const delta = payload.delta || payload.detail || ''
      if (delta) {
        const presentation = get().presentations[streamRunId]
        if (!presentation?.draftText) {
          get().push({ kind: 'status', runId: streamRunId, title: '產生回答' })
          get().setStatus('產生回答…', streamRunId)
        }
        get().appendText(delta, streamRunId)
        scanTaskLines(streamRunId, 'text', delta, (text, status) =>
          get().upsertTask(text, status, streamRunId),
        )
      }
      return
    }
    if (payload.kind === 'chunk') {
      if (payload.detail?.trim()) {
        get().push({
          kind: 'log',
          runId: streamRunId,
          title: payload.channel === 'stderr' ? 'stderr' : 'stdout',
          detail: payload.detail.slice(0, 400),
        })
      }
      return
    }
    if (payload.kind === 'done') {
      get().push({
        kind: 'done',
        runId: streamRunId,
        title: payload.title || 'CLI 完成',
        detail: payload.detail,
        ok: payload.ok !== false,
      })
      // The coordinator owns terminalization so the response bubble,
      // execution summary, and archive settle before the digest is frozen.
      get().setStatus(payload.title || 'CLI 完成', streamRunId)
      return
    }

    // Multi-path file events (Codex batch)
    const paths = [
      ...(payload.path ? [payload.path] : []),
      ...(payload.paths || []),
    ]
      .map((p) => String(p).trim())
      .filter(Boolean)
      .filter((p, index, all) => all.indexOf(p) === index)

    if (payload.kind === 'file' || paths.length > 0) {
      for (const p of paths.length ? paths : [payload.detail || '']) {
        const path = p.trim()
        if (!path || path.length > 500) continue
        const action = payload.action || 'edit'
        const label =
          action === 'create'
            ? `已建立 ${basen(path)}`
            : action === 'delete'
              ? `已刪除 ${basen(path)}`
              : `已編輯 ${basen(path)}`
        get().recordFileChange(
          {
            path,
            action,
            added: payload.added,
            removed: payload.removed,
          },
          streamRunId,
        )
        get().push({
          kind: 'file',
          runId: streamRunId,
          title: payload.title || label,
          detail: path,
          path,
          tool: payload.tool,
          ok: payload.ok !== false,
          added: payload.added,
          removed: payload.removed,
        })
      }
      if (paths.length) return
    }

    if (payload.kind === 'tool') {
      get().push({
        kind: 'tool',
        runId: streamRunId,
        title: payload.title || (payload.tool ? `已執行 ${payload.tool}` : '已執行指令'),
        detail: payload.detail || payload.delta,
        tool: payload.tool,
        ok: payload.ok,
      })
      // Infer file path from tool detail when CLIs don't emit structured file events
      const detail = payload.detail || ''
      const m =
        detail.match(/(?:path|file|filename)["']?\s*[:=]\s*["']([^"']+)["']/i) ||
        detail.match(/((?:[A-Za-z]:)?(?:[\\/][\w.\-@]+)+\.\w{1,12})/)
      if (m?.[1] && /write|edit|create|patch|apply/i.test(payload.tool || payload.title || '')) {
        get().recordFileChange({ path: m[1], action: 'edit' }, streamRunId)
        get().push({
          kind: 'file',
          runId: streamRunId,
          title: `已編輯 ${basen(m[1])}`,
          path: m[1],
          detail: m[1],
          ok: true,
        })
      }
      return
    }

    get().push({
      runId: streamRunId,
      kind:
        payload.kind === 'error'
          ? 'error'
          : payload.kind === 'log'
            ? 'log'
            : 'status',
      title: payload.title,
      detail: payload.detail || payload.delta,
      tool: payload.tool,
      ok: payload.ok,
    })
  },
}))
