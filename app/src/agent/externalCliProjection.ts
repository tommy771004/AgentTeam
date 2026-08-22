/**
 * Renderer-only projection bridge for Host-owned external CLI sessions.
 *
 * This module deliberately contains no process, filesystem, provider, or
 * Electron implementation imports. It asks the feature-detected preload API
 * for a bounded snapshot/replay and folds public lifecycle events into the
 * disposable activity/thread projections.
 */

import type { ExternalCliLifecycleEvent, ExternalCliSessionSnapshot } from './externalCliRunSession.ts'
import {
  externalLifecycleToStream,
  externalTerminalStatus,
  type ExternalCliStreamProjection,
} from './externalCliLifecycleProjection.ts'
import type { ExternalCliRecoveryProjection } from '../store/runActivityStore.ts'

const reconnectedExternalSessionCursors = new Map<string, number>()

function isExternalCliSessionSnapshot(value: unknown): value is ExternalCliSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ExternalCliSessionSnapshot>
  return typeof candidate.runId === 'string' && typeof candidate.conversationId === 'string' && typeof candidate.phase === 'string'
}

/** Rebuild live external CLI projections from Host state after renderer reload. */
export async function reconnectExternalCliSessions(): Promise<number> {
  const api = window.subagents?.cli
  if (!api?.sessionSnapshots) return 0
  let rawSnapshots: unknown[]
  try {
    const result = await api.sessionSnapshots()
    rawSnapshots = Array.isArray(result) ? result : []
  } catch {
    return 0
  }
  let rawRecovery: unknown[] = []
  if (api.sessionRecovery) {
    try {
      const result = await api.sessionRecovery()
      rawRecovery = Array.isArray(result) ? result : []
    } catch {
      rawRecovery = []
    }
  }
  if (!rawSnapshots.length && !rawRecovery.length) return 0

  const [{ useRunActivityStore }, { useThreadStore }] = await Promise.all([
    import('../store/runActivityStore.ts'),
    import('../store/threadStore.ts'),
  ])
  let restored = 0
  for (const raw of rawSnapshots) {
    if (!isExternalCliSessionSnapshot(raw)) continue
    const previousCursor = reconnectedExternalSessionCursors.get(raw.runId) || 0
    let snapshot = raw
    let events = raw.events || []
    let replayGap = false
    if (api.sessionEvents) {
      try {
        const response = await api.sessionEvents({ runId: raw.runId, cursor: previousCursor }) as { snapshot?: unknown; events?: unknown[]; replayGap?: boolean } | null
        if (isExternalCliSessionSnapshot(response?.snapshot)) snapshot = response.snapshot
        replayGap = response?.replayGap === true
        const replay = replayGap && isExternalCliSessionSnapshot(response?.snapshot)
          ? response.snapshot.events
          : response?.events
        events = Array.isArray(replay)
          ? replay.filter((event): event is ExternalCliLifecycleEvent => Boolean(event && typeof event === 'object' && typeof (event as { type?: unknown }).type === 'string'))
          : []
      } catch {
        // If the Host replay endpoint is temporarily unavailable, only apply
        // events newer than the acknowledged cursor. Replaying the complete
        // snapshot on every poll would duplicate renderer activity.
        events = events.filter((event) => event.sequence > previousCursor)
      }
    } else {
      events = events.filter((event) => event.sequence > previousCursor)
    }
    const activity = useRunActivityStore.getState()
    // A replay gap is a state reconstruction, not an append. Reset the
    // disposable projection before applying the retained event window.
    if (previousCursor === 0 || replayGap) activity.begin(snapshot.runId)
    const seen = new Set<number>()
    for (const event of events) {
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') continue
      if (seen.has(event.sequence)) continue
      seen.add(event.sequence)
      activity.handleCliStream(externalLifecycleToStream(event) as ExternalCliStreamProjection)
    }
    const terminalProjection = externalTerminalStatus(snapshot)
    activity.setStatus(terminalProjection.status, snapshot.runId)
    useThreadStore.getState().setExternalRun(snapshot.conversationId, {
      provider: snapshot.adapter,
      adapter: snapshot.adapter,
      runId: snapshot.runId,
      conversationId: snapshot.conversationId,
      processId: snapshot.processId,
      sessionId: snapshot.providerSessionId,
      status: terminalProjection.externalStatus,
      completionReason: snapshot.terminal?.reason || snapshot.terminal?.classification,
      eventCursor: snapshot.eventCursor,
      lastActivityAt: snapshot.lastMeaningfulActivityAt !== undefined
        ? new Date(snapshot.lastMeaningfulActivityAt).toISOString()
        : undefined,
      outputOmittedBytes: snapshot.output.omittedBytes,
      startedAt: new Date(snapshot.startedAt).toISOString(),
      finishedAt: snapshot.terminal ? new Date(snapshot.terminal.at).toISOString() : undefined,
    })
    reconnectedExternalSessionCursors.set(snapshot.runId, snapshot.eventCursor)
    restored += 1
  }
  for (const raw of rawRecovery) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as {
      runId?: unknown
      conversationId?: unknown
      adapter?: unknown
      phase?: unknown
      recovery?: {
        interruptedAt?: unknown
        reason?: unknown
        resumable?: unknown
        automaticRetry?: unknown
      }
      providerSessionId?: unknown
    }
    if (
      typeof record.runId !== 'string' ||
      typeof record.adapter !== 'string' ||
      record.phase !== 'interrupted' ||
      !record.recovery
    ) continue
    const runId = record.runId
    const recovery: ExternalCliRecoveryProjection = {
      runId,
      conversationId: typeof record.conversationId === 'string' ? record.conversationId : undefined,
      adapter: record.adapter,
      interruptedAt: typeof record.recovery.interruptedAt === 'number' ? record.recovery.interruptedAt : Date.now(),
      reason: typeof record.recovery.reason === 'string' ? record.recovery.reason.slice(0, 300) : 'Host process loss',
      resumable: record.recovery.resumable === true,
      automaticRetry: record.recovery.automaticRetry === true,
      providerSessionId: typeof record.providerSessionId === 'string' ? record.providerSessionId : undefined,
    }
    const activity = useRunActivityStore.getState()
    const existing = activity.getPresentation(runId)
    if (!existing || existing.terminal) activity.begin(runId)
    activity.setRecovery(recovery, runId)
    if (typeof record.conversationId === 'string' && record.conversationId) {
      useThreadStore.getState().setExternalRun(record.conversationId, {
        provider: record.adapter,
        adapter: record.adapter,
        runId,
        conversationId: record.conversationId,
        sessionId: recovery.providerSessionId,
        status: 'interrupted',
        completionReason: recovery.reason,
      })
    }
    restored += 1
  }
  return restored
}

/**
 * Cursor-poll Host state until every observed session is terminal.  This is
 * intentionally polling rather than holding an Electron sender callback, so
 * a renderer reload cannot leave a stale webContents subscription behind.
 */
export function startExternalCliSessionProjection(intervalMs = 750): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  const poll = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      await reconnectExternalCliSessions()
    } finally {
      inFlight = false
      if (!stopped) timer = setTimeout(() => { void poll() }, Math.max(250, intervalMs))
    }
  }
  void poll()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
