import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtocolsPage } from './pages/ProtocolsPage'
import { DocsPage } from './pages/DocsPage'
import { SuccessPage } from './pages/SuccessPage'
import { FailedPage } from './pages/FailedPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { DashboardPage } from './pages/DashboardPage'
import { OpsPage } from './pages/OpsPage'
import { RecordsPage } from './pages/RecordsPage'
import { UsagePage } from './pages/UsagePage'
import { ContentPublishingPage } from './pages/ContentPublishingPage'
import { RouteChunkBoundary, RouteChunkLoading } from './components/RouteChunkBoundary'
import { useSettingsStore } from './store/settingsStore'
import { useLearningStore } from './store/learningStore'
import { useScheduleStore } from './store/scheduleStore'
import { useAgentStore } from './store/agentStore'
import { useProjectStore } from './store/projectStore'
import { useGatewayStore } from './store/gatewayStore'
import type { ScheduledJob } from './agent/types'
import { createScheduleTriggerSnapshot } from './agent/scheduler'
import { scheduleSkillCurator } from './agent/hermes/curator'
import { scheduleDreamConsolidation } from './agent/hermes/dream'
import { onSkillsChanged } from './agent/hermes/skills'
import { pushSkillsToHost, syncSkillsToHost } from './agent/hermes/skillHostSync'
import {
  completeStartupRecovery,
  recordRunCompaction,
  waitForStartupRecovery,
} from './agent/runJournal.ts'
import { applyRendererStorageSnapshot } from './agent/updateMigration'
import { compareVersions } from './agent/updateContracts'
import type { PiSessionProjection } from './agent/piHostProjection'
import { applyPiHostActivityUpdate, mapPiHostEventToActivity } from './agent/piHostActivity'
import { recordAppendFromEvent } from './agent/liveTimeline'
import { presentReattachedApproval, reattachPiHostRuns } from './agent/activeRunReattachment'
import { usePiHostEventStore } from './store/piHostEventStore'
import { useRunActivityStore } from './store/runActivityStore'
import { useWorkingStateProjectionStore } from './store/workingStateProjectionStore'
import { usePermissionAskStore } from './store/permissionAskStore'
import { isElectronPiProduction } from './agent/piProduction'
import { startHostAgentQueuePump } from './agent/hostAgentQueuePump.ts'
import {
  classifyLiveExternalSessions,
  createStartupRecoveryPhaseTracker,
  isExternalThreadStillLive,
} from './agent/startupRecoveryPhases.ts'

const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const LearningPage = lazy(() => import('./pages/LearningPage').then((module) => ({ default: module.LearningPage })))
const SubDesignPage = lazy(() => import('./pages/SubDesignPage').then((module) => ({ default: module.SubDesignPage })))

const DevTrajectoryMeasurement = import.meta.env.DEV
  ? lazy(() => import('./DevTrajectoryMeasurement').then((module) => ({ default: module.DevTrajectoryMeasurement })))
  : null

function DeferredRoute({ children }: { children: ReactNode }) {
  return (
    <RouteChunkBoundary>
      <Suspense fallback={<RouteChunkLoading />}>
        {children}
      </Suspense>
    </RouteChunkBoundary>
  )
}

/** Restore automation queue from disk and drain when capacity is available */
function RunQueueBootstrap() {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      const { hydrateRunQueue, queueLength, drainExternalRunQueue } = await import('./agent/runQueue')
      const n = hydrateRunQueue()
      if (n > 0) {
        void window.subagents?.notify?.(
          'AgentStudio · 佇列',
          `已恢復 ${n} 筆待跑自動化任務`,
        )
      }
      // Let schedule/settings hydrate first, then retry transient capacity
      // reservations instead of abandoning a durable queued item forever.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 900 : 500))
        if (cancelled || queueLength() === 0) return
        if (!useAgentStore.getState().canStartRun().allowed) continue
        const { runTask } = await import('./agent/taskRunCoordinator')
        await drainExternalRunQueue((o) => runTask({ ...o, _fromQueue: true }))
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return null
}

function HostAgentQueueBootstrap() {
  useEffect(() => startHostAgentQueuePump(), [])
  return null
}

/** Pi Host is the history authority; Zustand only receives a disposable projection. */
function PiHostProjectionBootstrap() {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      const api = window.subagents?.piHost?.sessions
      if (cancelled) return
      if (!api?.list) {
        useWorkingStateProjectionStore.getState().setHostAvailable(false)
        return
      }
      try {
        const { useThreadStore } = await import('./store/threadStore')
        useThreadStore.getState().hydrate()
        const result = await api.list()
        if (cancelled) return
        const sessions = (result.sessions || []).filter((item): item is PiSessionProjection => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { title?: unknown }).title === 'string' && Array.isArray((item as { messages?: unknown }).messages)))
        useWorkingStateProjectionStore.getState().hydrateHostSessions(sessions)
        useThreadStore.getState().hydrateFromPiHost(sessions)
      } catch {
        useWorkingStateProjectionStore.getState().setHostAvailable(false)
        /* Host projection is best-effort; the durable Host remains authoritative. */
      }
    })()
    return () => { cancelled = true }
  }, [])
  return null
}

/** Keep Host tool decisions/results visible to the renderer without making it a second owner. */
function PiHostEventBootstrap() {
  const push = usePiHostEventStore((state) => state.push)
  useEffect(() => {
    const onEvent = window.subagents?.piHost?.onEvent
    if (!onEvent) return
    const unsubscribe = onEvent((event) => {
      push(event)
      if ((event as { event?: string }).event === 'memory/changed') {
        const revision = Number((event as { payload?: { revision?: unknown } }).payload?.revision)
        if (Number.isFinite(revision)) useLearningStore.getState().invalidateMemoryRevision(revision)
      }
      if ((event as { event?: string }).event === 'host/context') {
        const payload = (event as { payload?: Record<string, unknown> }).payload
        if (payload?.phase === 'compacted' && typeof payload.runId === 'string') {
          recordRunCompaction(payload.runId, {
            replacedMessages: Number(payload.replacedMessages) || 0,
            remainingMessages: Number(payload.remainingMessages) || 0,
            summaryChars: Number(payload.summaryChars) || 0,
            estimatedTokens: Number(payload.estimatedTokens) || 0,
            contextWindow: Number(payload.contextWindowTokens) || 0,
          })
        }
      }
      // In-turn asks ride the SAME HITL queue as every other approval: the
      // question surfaces in the permission panel and its answer resolves
      // back through approvals/resolve (user story 11).
      if ((event as { event?: string }).event === 'host/approval-requested') {
        const payload = (event as { payload?: { runId: string; threadId?: string; tool: string; callId: string; args?: Record<string, unknown>; reason?: string; timeoutMs?: number } }).payload
        if (payload) {
          presentReattachedApproval({
            ...payload,
            timeoutMs: payload.timeoutMs ?? 0,
          }, payload.threadId)
        }
        return
      }
      if ((event as { event?: string }).event === 'host/approval-resolved') {
        const payload = (event as { payload?: { runId?: string; callId?: string; decision?: 'allow' | 'deny' | 'timeout' | 'cancel' } }).payload
        if (payload?.runId && payload.callId && payload.decision) {
          usePermissionAskStore.getState().resolveHostRequest(
            payload.runId,
            payload.callId,
            payload.decision,
          )
        }
        return
      }
      // The Pi path's timeline is projected from the record, so record
      // appends are handled BEFORE the activity translator and never travel
      // through it: the activity stream stays what it always was — transport,
      // and the fallback for runners that keep no record (ADR-0039).
      const appended = recordAppendFromEvent(event as { event?: unknown; payload?: unknown })
      if (appended) {
        useRunActivityStore.getState().appendRecordEntries(appended.entries, appended.runId)
        useWorkingStateProjectionStore.getState().appendHostRecord(appended.entries, appended.runId)
        return
      }
      const update = mapPiHostEventToActivity(event)
      if (!update) return
      applyPiHostActivityUpdate(useRunActivityStore.getState(), update)
    })
    return () => { unsubscribe?.() }
  }, [push])
  return null
}

/**
 * One-way skill migration (issue 16): the renderer's localStorage copy is
 * written into the Host-owned skills directory once, with a per-skill report.
 * The flag flips only when every skill synced, so a partial migration RETRIES
 * on next boot instead of being silently assumed complete.
 */
function SkillsMigrationBootstrap() {
  // The one-shot migration below only seeds the FIRST boot. Skills auto-load
  // exclusively through the Host-owned directory (ADR-0034), so every later
  // mutation（技能庫儲存／釘選／刪除、學習草稿核准、curator 封存）must reach
  // it too — otherwise a new skill would sit in localStorage and never load.
  useEffect(() => onSkillsChanged(pushSkillsToHost), [])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const MIGRATION_KEY = 'subagents.skillsMigration.v1'
      try {
        if (localStorage.getItem(MIGRATION_KEY)) return
        const sync = window.subagents?.piHost?.resources?.syncSkills
        if (!sync) return
        // Wait for the Host bridge, then push the renderer copy once.
        for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          try {
            if (!useLearningStore.getState().loaded) {
              await useLearningStore.getState().load()
            }
            await syncSkillsToHost()
            if (cancelled) return
            // Every attempt publishes its per-skill outcome (issue 16). A skill
            // that failed to migrate used to vanish here: only `every(ok)` was
            // read, the rest was dropped, and the loop retried in silence. The
            // report is read on the Skills page, where a failing skill stays
            // listed with the reason it failed.
            const { useSkillMigrationStore } = await import('./store/skillMigrationStore')
            const report = useSkillMigrationStore.getState().report
            if (!report || report.unreachable) continue
            const complete = report.complete && report.outcomes.every((outcome) =>
              outcome.ok && typeof outcome.slug === 'string' && outcome.slug.length > 0)
            if (complete) {
              localStorage.setItem(MIGRATION_KEY, JSON.stringify({
                completedAt: new Date().toISOString(),
                skillsDir: report.skillsDir,
                count: report.outcomes.length,
              }))
              return
            }
          } catch {
            /* Host not ready yet; retry until the attempt budget runs out */
          }
        }
        // The budget ran out without the Host ever answering. Saying so beats
        // leaving no trace: "we could not reach the Host" and "your skills
        // migrated fine" must not look the same.
        if (!cancelled) {
          const { useSkillMigrationStore } = await import('./store/skillMigrationStore')
          if (!useSkillMigrationStore.getState().report) {
            useSkillMigrationStore.getState().setReport({
              at: new Date().toISOString(),
              skillsDir: '',
              complete: false,
              unreachable: true,
              outcomes: [],
            })
          }
        }
      } catch {
        /* migration is best-effort; a missing bridge must not break boot */
      }
    })()
    return () => { cancelled = true }
  }, [])
  return null
}

/** Rebuild live external CLI activity from Host snapshots after renderer reload. */
function ExternalCliSessionBootstrap() {  useEffect(() => {
    let cancelled = false
    let stopProjection: (() => void) | undefined
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      if (!window.subagents?.cli?.sessionSnapshots) return
      const { startExternalCliSessionProjection } = await import('./agent/externalCliProjection')
      if (!cancelled) {
        // Keep the polling owner bound to this renderer lifecycle. The
        // cleanup below stops new polls before a reload can race stale UI.
        stopProjection = startExternalCliSessionProjection()
      }
    })()
    return () => {
      cancelled = true
      stopProjection?.()
    }
  }, [])
  return null
}

/** Reconcile durable run markers before schedulers/queues are allowed to drain. */
function RecoveryBootstrap() {
  useEffect(() => {
    let cancelled = false
    let recoveryUnsubscribe: (() => void) | undefined
    let recoveryUnsubscribeTimer: ReturnType<typeof setTimeout> | undefined
    const recoveryPhases = createStartupRecoveryPhaseTracker()
    void (async () => {
      let journal: typeof import('./agent/runJournal.ts') | undefined
      try {
        const loaded = await import('./agent/runJournal.ts')
        journal = loaded
        recoveryPhases.advance('durable-read')
      // A successful installer restart replays the bounded renderer snapshot
      // before any store hydrates, then marks the transaction complete.
      const migration = await window.subagents?.updates?.pendingMigration?.()
      const migrationState = migration?.state as { manifest?: { version?: string } } | undefined
      const runningVersion = await window.subagents?.version?.()
      const targetVersion = migrationState?.manifest?.version
      const installerDidNotAdvance = Boolean(targetVersion && runningVersion && compareVersions(runningVersion, targetVersion) < 0)
      if (migration?.ok && migration.snapshot?.rendererStorage && !installerDidNotAdvance) {
        replaceRendererStorage(migration.snapshot.rendererStorage)
        const migratedRoot = migration.snapshot.rendererStorage['subagents.project.root.v1']
        if (migratedRoot) {
          await useProjectStore.getState().setRoot(migratedRoot)
          await window.subagents?.project?.setActiveRoot?.(migratedRoot)
        }
        await window.subagents?.updates?.completeMigration?.(migration.snapshot)
        journal.recordRecoveryNotice({ kind: 'storage', id: 'update-migration', action: 'resume-once', detail: '已套用 N-1→N migration snapshot，保留本機 threads/settings/queue/projects/Artifact Index。' })
      } else if (migration?.ok && migration.snapshot && installerDidNotAdvance) {
        const rollback = await window.subagents?.updates?.rollback?.()
        if (rollback?.ok && rollback.snapshot?.rendererStorage) {
          replaceRendererStorage(rollback.snapshot.rendererStorage)
          const restoredRoot = rollback.snapshot.rendererStorage['subagents.project.root.v1']
          if (restoredRoot) {
            await useProjectStore.getState().setRoot(restoredRoot)
            await window.subagents?.project?.setActiveRoot?.(restoredRoot)
          }
          await window.subagents?.updates?.completeMigration?.(rollback.snapshot)
        }
        journal.recordRecoveryNotice({ kind: 'storage', id: 'update-migration', action: rollback?.ok ? 'restored' : 'quarantined', detail: rollback?.ok ? '安裝程式未完成版本切換，已自動回復 N-1 migration snapshot。' : '安裝程式未完成版本切換，migration 回復失敗；目前版本仍可啟動。' })
      }
        const queue = await import('./agent/runQueue')
      const { useThreadStore } = await import('./store/threadStore')
      // Hydrate the visible thread before applying interrupted status so a
      // crash cannot silently turn the user's history into a blank thread.
      useThreadStore.getState().hydrate()
      // Electron/Pi Host owns conversation history. Reconcile against the
      // durable Host projection before applying interrupted status; otherwise
      // startup recovery only sees the temporary renderer placeholder.
      recoveryPhases.advance('host-reconciliation')
      const piSessions = await window.subagents?.piHost?.sessions?.list?.()
      if (Array.isArray(piSessions?.sessions)) {
        const projected = piSessions.sessions.filter((item): item is PiSessionProjection => Boolean(
          item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' &&
          typeof (item as { title?: unknown }).title === 'string' &&
          Array.isArray((item as { messages?: unknown }).messages),
        ))
        useWorkingStateProjectionStore.getState().hydrateHostSessions(projected)
        useThreadStore.getState().hydrateFromPiHost(projected)
      } else {
        useWorkingStateProjectionStore.getState().setHostAvailable(false)
      }
      // Pi Core Host owns active/terminal execution truth. Subscribe before
      // querying it, buffer record appends during attach, then merge by the
      // Turn Record sequence so a renderer reload cannot create a startup gap.
      recoveryPhases.advance('cursor-replay')
      const hostTruth = await reattachPiHostRuns((unsubscribe) => {
        recoveryUnsubscribe = unsubscribe
      })
      recoveryPhases.advance('active-reattachment')
      const journalReport = await (async () => {
        if (!journal) return null
        // Durable mirror must be wired and hydrated BEFORE reconcileStartup:
        // an evicted localStorage would otherwise mark runs interrupted from
        // an empty journal instead of the restored one.
        const mirrorApi = window.subagents?.journal
        if (mirrorApi) {
          journal.setRunJournalMirrorBridge({ read: () => mirrorApi.read(), write: (state: string) => mirrorApi.write(state) })
          try { await journal.hydrateRunJournalFromDurable() } catch { /* best effort */ }
        }
        if (hostTruth === null) return null
        return journal.reconcileStartup(hostTruth)
      })()
      const hasRunRecovery = (journalReport?.items || []).some(
        (item) => item.kind === 'run' && item.action === 'marked-interrupted',
      )
      const activeExternalSessions = await window.subagents?.cli?.sessionSnapshots?.()
      const liveExternalSessions = classifyLiveExternalSessions(activeExternalSessions)

      // Host checkpoints survive a renderer promise disappearing. Re-run the
      // coordinator's one-shot finalization owner before presenting recovery,
      // so archive/summary/release/queue-drain effects cannot be lost.
      recoveryPhases.advance('terminal-finalization')
      const recoveredExternal = await window.subagents?.cli?.sessionRecovery?.()
      if (Array.isArray(recoveredExternal) && recoveredExternal.length) {
        const { finalizeRecoveredExternalRun } = await import('./agent/taskRunCoordinator')
        for (const candidate of recoveredExternal) {
          if (!candidate || typeof candidate !== 'object') continue
          const record = candidate as {
            runId?: unknown
            conversationId?: unknown
            adapter?: unknown
            phase?: unknown
            recovery?: { reason?: unknown }
          }
          if (record.phase !== 'interrupted' || typeof record.runId !== 'string' || typeof record.adapter !== 'string') continue
          try {
            await finalizeRecoveredExternalRun({
              runId: record.runId,
              threadId: typeof record.conversationId === 'string' ? record.conversationId : undefined,
              conversationId: typeof record.conversationId === 'string' ? record.conversationId : undefined,
              adapter: record.adapter,
              reason: typeof record.recovery?.reason === 'string' ? record.recovery.reason : undefined,
            })
          } catch (error) {
            journal.recordRecoveryNotice({
              kind: 'run',
              id: record.runId,
              action: 'quarantined',
              detail: `外部 CLI 終態復原失敗，已停止隱性重跑：${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
            })
          }
        }
      }

      // A legacy/partially-written journal may be absent while the persisted
      // thread still says running; reconcile that visible state as a fallback.
      const threadStore = useThreadStore.getState()
      for (const thread of threadStore.threads) {
        if (thread.lastStatus !== 'running') continue
        // A renderer reload must not mark a still-live Host session as
        // interrupted. The Electron registry is the authority for this case.
        if (isExternalThreadStillLive(thread, liveExternalSessions)) continue
        threadStore.setThreadStatus(thread.id, 'interrupted')
        if (!hasRunRecovery) {
          journal.recordRecoveryNotice({
            kind: 'run',
            id: thread.id,
            previousStatus: 'running',
            action: 'marked-interrupted',
            detail: '對話狀態顯示執行中，但沒有可用的 journal marker。',
          })
        }
      }

      recoveryPhases.advance('queue-drain')
      const restoredQueue = queue.hydrateRunQueue()
      if (restoredQueue > 0) {
        journal.recordRecoveryNotice({
          kind: 'queue',
          id: 'startup',
          action: 'resume-once',
          detail: `已恢復 ${restoredQueue} 筆待跑工作；每筆 runId 只允許補跑一次。`,
        })
      }

      // Scheduler storage is main-process backed in Electron. Mark jobs that
      // were running during termination interrupted before the ticker starts.
      const schedule = useScheduleStore.getState()
      await schedule.load()
      const loadedJobs = useScheduleStore.getState().jobs
      const recoveredScheduleIds = new Set(
        (journalReport?.items || [])
          .filter((item) => item.kind === 'schedule' && item.action === 'marked-interrupted')
          .map((item) => item.id),
      )
      const queuedScheduleItems = new Map(
        queue
          .listQueuedRuns()
          .filter((item) => item.meta?.scheduleJobId)
          .map((item) => [item.meta!.scheduleJobId!, item]),
      )
      for (const job of loadedJobs) {
        const hadRecoveredMarker = recoveredScheduleIds.has(job.id)
        if (job.lastStatus !== 'running' && !hadRecoveredMarker) continue
        const queued = queuedScheduleItems.get(job.id)
        try {
          await schedule.markJobResult(job.id, 'interrupted')
        } catch (error) {
          journal.recordRecoveryNotice({
            kind: 'storage',
            id: job.id,
            previousStatus: 'running',
            action: 'quarantined',
            detail: `排程復原寫入失敗，已停止自動補跑：${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
          })
          continue
        }
        if (queued && queued.meta?.scheduleTriggeredAt === job.lastRunAt) {
          // The queue still owns the claimed trigger. Re-bind the job to
          // running so trigger validation accepts exactly one safe drain.
          await schedule.markJobResult(job.id, 'running')
          journal.recordRecoveryNotice({
            kind: 'schedule',
            id: job.id,
            previousStatus: 'interrupted',
            action: 'resume-once',
            detail: `排程「${job.name.slice(0, 80)}」仍由佇列持有，啟動時只補跑一次。`,
          })
        } else if (queued) {
          queue.removeQueuedRun(queued.id)
          journal.recordRecoveryNotice({
            kind: 'queue',
            id: queued.id,
            action: 'quarantined',
            detail: '排程 trigger 與已儲存 job 不一致，已停止不安全補跑。',
          })
        } else if (!hadRecoveredMarker) {
          journal.recordRecoveryNotice({
            kind: 'schedule',
            id: job.id,
            previousStatus: 'running',
            action: 'marked-interrupted',
            detail: `排程「${job.name.slice(0, 80)}」在程序中斷時仍為 running。`,
          })
        }
      }
      const loadedJobIds = new Set(loadedJobs.map((job) => job.id))
      for (const [jobId, queued] of queuedScheduleItems) {
        if (loadedJobIds.has(jobId)) continue
        queue.removeQueuedRun(queued.id)
        journal.recordRecoveryNotice({
          kind: 'queue',
          id: queued.id,
          action: 'quarantined',
          detail: `找不到排程 ${jobId}，已停止不安全補跑並等待使用者處理。`,
        })
      }

      // Completions the user was never told about. Claiming marks each entry
      // consumed in the same pass, so repeated restarts cannot narrate the same
      // run twice; the messages then ride the existing recovery report → system
      // bubble → OS notify path rather than a second recovery route.
      const { narratePendingDelivery } = await import('./agent/runRedelivery')
      const threadState = useThreadStore.getState()
      for (const entry of journal.claimPendingRunDeliveries()) {
        const narration = narratePendingDelivery(
          entry,
          Boolean(entry.threadId && threadState.threads.some((thread) => thread.id === entry.threadId)),
        )
        if (narration.message && narration.threadId) {
          useThreadStore.getState().pushBubble(narration.threadId, 'system', narration.message)
        }
        if (narration.recovery) journal.recordRecoveryNotice(narration.recovery)
      }

      recoveryPhases.complete()

      if (cancelled) return
      const reports = journal.consumeRecoveryReports()
      const items = reports.flatMap((report) => report.items)
      if (!items.length) return
      const activeId = useThreadStore.getState().activeId
      if (activeId) {
        const detail = items
          .slice(-12)
          .map((item) => `${item.action} · ${item.kind}/${item.id}${item.detail ? ` · ${item.detail}` : ''}`)
          .join('\n')
        useThreadStore.getState().pushBubble(
          activeId,
          'system',
          `啟動復原報告（${items.length} 項）\n${detail}`,
        )
      }
      void window.subagents?.notify?.(
        'AgentStudio · 啟動復原',
        `${items.length} 項本機狀態已標記為中斷或安全補跑。`,
      )
      } catch (error) {
        recoveryPhases.fail(error)
        useWorkingStateProjectionStore.getState().setHostAvailable(false)
        const detail = `啟動復原未完整完成，已停止隱性重跑：${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
        journal?.recordRecoveryNotice({
          kind: 'storage',
          id: 'startup-recovery',
          action: 'quarantined',
          detail,
        })
        const { useThreadStore } = await import('./store/threadStore')
        const activeId = useThreadStore.getState().activeId
        if (activeId) {
          useThreadStore.getState().pushBubble(activeId, 'system', `啟動復原報告（失敗）\n${detail}`)
        }
        void window.subagents?.notify?.('AgentStudio · 啟動復原', detail)
      } finally {
        completeStartupRecovery()
        // StartupGate can now mount PiHostEventBootstrap. Release this
        // pre-query buffer listener on the next task, after the ordinary
        // transport listener has had a React commit to take over.
        recoveryUnsubscribeTimer = setTimeout(() => {
          recoveryUnsubscribe?.()
          recoveryUnsubscribe = undefined
        }, 0)
      }
    })()
    return () => {
      cancelled = true
      if (recoveryUnsubscribeTimer) clearTimeout(recoveryUnsubscribeTimer)
      recoveryUnsubscribe?.()
      recoveryUnsubscribe = undefined
    }
  }, [])
  return null
}

/** Keep route/store side effects out of the tree until recovery has settled. */
function StartupGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void waitForStartupRecovery().then(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [])
  return ready ? <>{children}</> : null
}

/** Replace app-owned storage with a recoverable write path on quota errors. */
function replaceRendererStorage(snapshot: Record<string, string>) {
  const current: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key) {
      const value = localStorage.getItem(key)
      if (value != null) current[key] = value
    }
  }
  const restored = applyRendererStorageSnapshot(current, snapshot)
  try {
    for (const key of Object.keys(current)) localStorage.removeItem(key)
    for (const [key, value] of Object.entries(restored)) localStorage.setItem(key, value)
  } catch (error) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i)
        if (key) localStorage.removeItem(key)
      }
      for (const [key, value] of Object.entries(current)) localStorage.setItem(key, value)
    } catch {
      /* The outer recovery handler records the failure; never hide it. */
    }
    throw error
  }
}

/** Trigger Hermes Skill Curator from idle transitions, never from a second cron. */
function SkillCuratorBootstrap() {
  const isRunning = useAgentStore((s) => s.isRunning)
  const skillCount = useLearningStore((s) => s.skills.length)
  const settings = useSettingsStore((s) => s.settings)
  const projectRoot = useProjectStore((s) => s.root)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled || isRunning) return
      if (!isElectronPiProduction()) scheduleSkillCurator(settings)
      // G6 dream:閒置時整併機器寫入記憶(gate:≥4h 且新條目 ≥3)
      scheduleDreamConsolidation(settings, undefined, projectRoot || undefined)
    })()
    return () => { cancelled = true }
  }, [isRunning, projectRoot, skillCount, settings])

  return null
}

function SchedulerBootstrap() {
  const navigate = useNavigate()
  const load = useScheduleStore((s) => s.load)
  const startTicker = useScheduleStore((s) => s.startTicker)
  const markJobResult = useScheduleStore((s) => s.markJobResult)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      if (!cancelled) await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      await waitForStartupRecovery()
      if (cancelled) return undefined
      const onDue = (job: ScheduledJob) => {
      void (async () => {
        const scheduleTrigger = createScheduleTriggerSnapshot(job)
        await markJobResult(job.id, 'running')
        void window.subagents?.notify?.('AgentStudio · 排程', `執行任務：${job.name}`)
        navigate('/')
        const { runTask } = await import('./agent/taskRunCoordinator')
        const settleJob = async (r: {
          status: string
          skipped?: boolean
          queued?: boolean
          skipReason?: string
        }) => {
          if (r.skipped) {
            if (r.skipReason === 'cancelled') {
              await markJobResult(job.id, 'skipped')
              void window.subagents?.notify?.(
                'AgentStudio · 排程',
                `任務 ${job.name}：已從佇列取消`,
              )
            }
            return
          }
          const ok = r.status === 'success'
          await markJobResult(job.id, ok ? 'success' : 'failed')
          void window.subagents?.notify?.(
            'AgentStudio · 排程',
            `任務 ${job.name}：${ok ? '成功' : '失敗'}`,
          )
        }
        const r = await runTask({
          sourceKind: 'schedule',
          objective: job.objective,
          title: job.name || '排程',
          loopType: job.loopType || 'Time-based',
          attachedSkills: job.skillNames || [],
          runner: job.runner || 'builtin',
          projectRoot: job.projectRoot || undefined,
          sourceLabel: `定時任務：${job.name}`,
          unattended: true,
          // Durable across app restart (queue persistence rebinds via scheduleJobId)
          meta: {
            scheduleJobId: scheduleTrigger.jobId,
            scheduleTriggeredAt: scheduleTrigger.triggeredAt,
            scheduleKind: scheduleTrigger.scheduleKind,
          },
          // In-memory path while app stays open
          onSettled: (result) => settleJob(result),
        })
        if (r.skipped) {
          if (r.queued) {
            void window.subagents?.notify?.(
              'AgentStudio · 排程',
              `任務 ${job.name}：忙碌，已加入待跑佇列（完成後回寫狀態）`,
            )
            return
          }
          await markJobResult(job.id, 'skipped')
          void window.subagents?.notify?.(
            'AgentStudio · 排程',
            `任務 ${job.name}：忙碌略過`,
          )
          return
        }
        // onSettled already called settleJob — do not double-mark
      })()
    }
      return startTicker(onDue)
    }
    let stop: (() => void) | undefined
    void start().then((cleanup) => {
      stop = cleanup
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [startTicker, markJobResult, navigate])

  return null
}

/** Bridge Electron webhook HTTP hits → Proactive event matching → agent run */
function WebhookBootstrap() {
  const credentialReady = useSettingsStore((s) => s.loaded && !s.credentialMigrationError)
  const navigate = useNavigate()
  const matchEventEvidence = useScheduleStore((s) => s.matchEventEvidence)
  const recordEventTrigger = useScheduleStore((s) => s.recordEventTrigger)
  const load = useScheduleStore((s) => s.load)
  const settings = useSettingsStore((s) => s.settings)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      if (!cancelled) await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  // Auto-start / stop webhook when settings say so (after load)
  useEffect(() => {
    if (!window.subagents?.webhook) return
    if (!credentialReady) return
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      if (settings.webhookEnabled) {
        try {
          await window.subagents!.webhook!.start({
            port: settings.webhookPort || 8787,
          })
        } catch {
          /* main may already own server */
        }
      } else {
        // P1: closing settings must stop existing listener/server
        try {
          await window.subagents!.webhook!.stop?.()
        } catch {
          /* ignore */
        }
      }
    })()
    return () => { cancelled = true }
  }, [credentialReady, settings.webhookEnabled, settings.webhookPort])

  useEffect(() => {
    if (!window.subagents?.webhook?.onEvent) return
    let cancelled = false
    let unsub: (() => void) | undefined
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      unsub = window.subagents?.webhook?.onEvent?.((payload) => {
      const matched = matchEventEvidence({
        source: payload.source || 'webhook.http',
        subject: payload.subject,
        hasAttachment: payload.hasAttachment,
        body: payload.body,
        receivedAt: payload.receivedAt,
      })
      if (!matched) {
        void window.subagents?.notify?.(
          'AgentStudio · Webhook',
          `沒有規則匹配：${payload.source || 'event'}`,
        )
        return
      }
      void (async () => {
        const event = matched.event
        await recordEventTrigger(event.id, matched.trigger)
        void window.subagents?.notify?.(
          'AgentStudio · Webhook',
          `已匹配 rule: ${event.name}`,
        )
        navigate('/')
        const { runTask } = await import('./agent/taskRunCoordinator')
        const body = (payload.body || '').trim()
        const subject = (payload.subject || '').trim()
        const extraParts = [
          subject ? `Subject: ${subject}` : '',
          payload.source ? `Source: ${payload.source}` : '',
          body ? body : '',
        ].filter(Boolean)
        const r = await runTask({
          sourceKind: 'webhook',
          objective: event.objective,
          title: event.name,
          loopType: 'Proactive',
          eventPreMatched: true,
          sourceLabel: `Webhook 事件：${event.name}`,
          unattended: true,
          meta: { eventTrigger: matched.trigger },
          extraContext: extraParts.length
            ? extraParts.join('\n\n').slice(0, 12_000)
            : undefined,
        })
        if (r.skipped) {
          void window.subagents?.notify?.(
              'AgentStudio · Webhook',
            r.queued
              ? `已匹配 ${event.name}：忙碌，已加入待跑佇列`
              : `已匹配 ${event.name}，但代理忙碌 — 已略過`,
          )
        }
      })()
      })
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [matchEventEvidence, recordEventTrigger, navigate])

  return null
}

/** Monitor 事件流使用和 webhook 相同的 Proactive event matching 規則。 */
function MonitorBootstrap() {
  const navigate = useNavigate()
  const matchEventEvidence = useScheduleStore((s) => s.matchEventEvidence)
  const recordEventTrigger = useScheduleStore((s) => s.recordEventTrigger)

  useEffect(() => {
    const monitorApi = window.subagents?.monitor
    if (!monitorApi?.onEvent) return
    let cancelled = false
    let unsubEvent: (() => void) | undefined
    let unsubStopped: (() => void) | undefined
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      unsubEvent = monitorApi.onEvent((payload) => {
      const matched = matchEventEvidence({
        source: 'monitor',
        subject: payload.description,
        body: payload.line,
        receivedAt: payload.at,
      })
      // monitor 行數多,未匹配的行靜默略過(不像 webhook 逐則通知)
      if (!matched) return
      void (async () => {
        const event = matched.event
        await recordEventTrigger(event.id, matched.trigger)
        navigate('/')
        const { runTask } = await import('./agent/taskRunCoordinator')
        await runTask({
          sourceKind: 'event',
          objective: event.objective,
          title: event.name,
          loopType: 'Proactive',
          eventPreMatched: true,
          sourceLabel: `Monitor 事件：${event.name}（${payload.description}）`,
          unattended: true,
          meta: { eventTrigger: matched.trigger },
          extraContext: `Monitor: ${payload.description}\nLine: ${payload.line}`.slice(0, 4000),
        })
      })()
      })
      unsubStopped = monitorApi.onStopped?.((payload) => {
      if (payload.reason === 'volume' || payload.reason === 'error') {
        void window.subagents?.notify?.(
          'AgentStudio · Monitor',
          `monitor ${payload.description} 已停止（${payload.reason}）${payload.detail ? `：${payload.detail.slice(0, 100)}` : ''}`,
        )
      }
      })
    })()
    return () => {
      cancelled = true
      unsubEvent?.()
      unsubStopped?.()
    }
  }, [matchEventEvidence, recordEventTrigger, navigate])

  return null
}

function GatewayBootstrap() {
  const credentialReady = useSettingsStore((s) => s.loaded && !s.credentialMigrationError)
  const navigate = useNavigate()
  const settings = useSettingsStore((s) => s.settings)
  const pushInbound = useGatewayStore((s) => s.pushInbound)
  const refreshStatus = useGatewayStore((s) => s.refreshStatus)

  // Auto-start telegram from settings
  useEffect(() => {
    const gw = window.subagents?.gateway
    if (!gw || !credentialReady) return
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      if (settings.telegramEnabled) {
        try {
          await gw.telegramStart({
            allowedChatIds: settings.telegramAllowedChatIds || '',
          })
        } catch {
          /* main may already own poller */
        }
      } else {
        try {
          await gw.telegramStop()
        } catch {
          /* ignore */
        }
      }
      await refreshStatus()
    })()
    return () => { cancelled = true }
  }, [
    credentialReady,
    settings.telegramEnabled,
    settings.telegramAllowedChatIds,
    refreshStatus,
  ])

  useEffect(() => {
    if (!window.subagents?.gateway?.onInbound) return
    let cancelled = false
    let unsub: (() => void) | undefined
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      unsub = window.subagents?.gateway?.onInbound?.((msg) => {
      pushInbound(msg)

      const text = (msg.text || '').trim()
      const rawAtts = (
        msg as {
          attachments?: Array<{
            name: string
            mimeType: string
            kind: 'image' | 'text' | 'binary'
            dataUrl?: string
            size?: number
          }>
        }
      ).attachments
      if ((text === '/ping' || text === '/status') && !rawAtts?.length) {
        void window.subagents?.gateway?.send({
          channel: msg.channel,
          chatId: msg.chatId,
          text: `AgentStudio 在線 · running=${useAgentStore.getState().isRunning}`,
        })
        return
      }

      const s = useSettingsStore.getState().settings
      if (!s.telegramAutoRun) return
      if (!text && !rawAtts?.length) return

      void (async () => {
        void window.subagents?.notify?.(
          'AgentStudio · Telegram',
          `${msg.from || msg.chatId}: ${(text || '（附件）').slice(0, 80)}`,
        )
        navigate('/')
        const { runTask } = await import('./agent/taskRunCoordinator')
        const attachments = (rawAtts || [])
          .filter((a) => a.dataUrl || a.kind === 'text')
          .map((a, i) => ({
            id: `tg_${Date.now().toString(36)}_${i}`,
            kind: a.kind === 'image' ? ('image' as const) : a.kind === 'text' ? ('text' as const) : ('binary' as const),
            name: a.name || `tg-${i}`,
            mimeType: a.mimeType || 'application/octet-stream',
            size: a.size || 0,
            dataUrl: a.dataUrl,
          }))
        // Goal-based: free-form chat, not event-predicate language
        const replyTelegram = async (summary: string) => {
          if (!s.telegramReplyWithResult) return
          await window.subagents?.gateway?.send({
            channel: msg.channel,
            chatId: msg.chatId,
            text: summary.slice(0, 3500),
          })
        }
        const r = await runTask({
          sourceKind: 'telegram',
          objective: text || (attachments.length ? '請分析我附上的圖片或檔案。' : ''),
          title: `TG ${msg.chatId}`,
          loopType: 'Goal-based',
          sourceLabel: `Telegram · ${msg.from || msg.chatId}`,
          unattended: true,
          attachments: attachments.length ? attachments : undefined,
          extraContext: attachments.length
            ? `Telegram 附件 ${attachments.length} 個（已下載）`
            : undefined,
          // P1: reply after queue drain as well
          onSettled: async (result) => {
            if (!s.telegramReplyWithResult) return
            const agent = useAgentStore.getState().agent
            const summary =
              agent.result?.slice(0, 3500) ||
              result.result?.slice(0, 3500) ||
              `狀態：${result.status}`
            await replyTelegram(summary)
          },
        })
        if (r.skipped) {
          await window.subagents?.gateway?.send({
            channel: msg.channel,
            chatId: msg.chatId,
            text: r.queued
              ? '代理忙碌中，你的訊息已加入待跑佇列，稍後會自動執行並回覆。'
              : '代理忙碌中，請稍後再試。',
          })
          return
        }
        // Non-queued: onSettled already sent telegram reply when enabled
      })()
      })
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [pushInbound, navigate])

  return null
}

/** Apply ChatGPT-style general/appearance prefs to document */
function PreferencesBootstrap() {
  const settings = useSettingsStore((s) => s.settings)
  const isRunning = useAgentStore((s) => s.isRunning)

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => {
      const theme = settings.theme || 'dark'
      if (theme === 'system') {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        root.setAttribute('data-theme', dark ? 'dark' : 'light')
      } else {
        root.setAttribute('data-theme', theme)
      }
    }
    applyTheme()

    let reduced = settings.reducedMotion || 'system'
    if (reduced === 'system') {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'on'
        : 'off'
    }
    root.setAttribute('data-reduced-motion', reduced === 'on' ? 'on' : 'off')
    root.setAttribute(
      'data-sidebar-solid',
      settings.translucentSidebar === false ? 'true' : 'false',
    )
    root.style.setProperty('--app-ui-font-size', `${settings.uiFontSize || 14}px`)
    root.style.setProperty('--app-code-font-size', `${settings.codeFontSize || 13}px`)

    // Live follow system theme / reduced motion
    const mqTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onTheme = () => {
      if ((settings.theme || 'dark') === 'system') applyTheme()
    }
    const onMotion = () => {
      if ((settings.reducedMotion || 'system') === 'system') {
        root.setAttribute(
          'data-reduced-motion',
          mqMotion.matches ? 'on' : 'off',
        )
      }
    }
    mqTheme.addEventListener('change', onTheme)
    mqMotion.addEventListener('change', onMotion)
    return () => {
      mqTheme.removeEventListener('change', onTheme)
      mqMotion.removeEventListener('change', onMotion)
    }
  }, [settings])

  // Run-complete notification and sound now live on the per-run falling edge
  // (`useRunCompletionNotices`), so each concurrent run is announced once with
  // its own outcome instead of one aggregate signal when everything is idle.

  // Best-effort prevent sleep while running
  useEffect(() => {
    if (!settings.preventSleepWhileRunning) return
    if (!isRunning) return
    let released = false
    const release = () => {
      if (released) return
      released = true
      void window.subagents?.power?.allowSleep?.()
    }
    void window.subagents?.power?.preventSleep?.()
    return () => release()
  }, [isRunning, settings.preventSleepWhileRunning])

  return null
}

function PluginTokenRefreshBootstrap() {
  const start = useLearningStore((s) => s.startTokenRefreshScheduler)
  const stop = useLearningStore((s) => s.stopTokenRefreshScheduler)
  const loaded = useLearningStore((s) => s.loaded)

  useEffect(() => {
    if (!loaded) return
    let cancelled = false
    void (async () => {
      await waitForStartupRecovery()
      if (!cancelled) start()
    })()
    return () => {
      cancelled = true
      stop()
    }
  }, [loaded, start, stop])

  return null
}

/** When project root changes, rebind npm-mcp ${projectRoot} args + restart sessions */
function PluginProjectRebindBootstrap() {
  const rebind = useLearningStore((s) => s.rebindPluginProjectRoots)
  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void (async () => {
      await waitForStartupRecovery()
      if (cancelled) return
      unsubscribe = useProjectStore.subscribe((s, prev) => {
        if (s.root && s.root !== prev.root) void rebind(s.root)
      })
    })()
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [rebind])
  return null
}

export default function App() {
  const loadSettings = useSettingsStore((s) => s.load)
  const loadLearning = useLearningStore((s) => s.load)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // RecoveryBootstrap applies a pending N-1→N renderer snapshot first.
      // Do not hydrate settings/learning from the pre-migration module cache.
      await waitForStartupRecovery()
      if (cancelled) return
      await loadSettings()
      await loadLearning()
      if (cancelled) return
      await useLearningStore.getState().loadSkillCatalog(useProjectStore.getState().root || undefined)
      if (cancelled) return
      void import('./store/projectStore').then(({ useProjectStore }) => {
        useProjectStore.subscribe((s, prev) => {
          if (s.root !== prev.root) {
            void useLearningStore.getState().loadSkillCatalog(s.root || undefined)
          }
        })
      })
    })()
    return () => { cancelled = true }
  }, [loadSettings, loadLearning])

  if (
    import.meta.env.DEV &&
    window.location.hash === '#/trajectory-measurement' &&
    DevTrajectoryMeasurement
  ) {
    return (
      <Suspense fallback={null}>
        <DevTrajectoryMeasurement />
      </Suspense>
    )
  }

  return (
    <HashRouter>
      <RecoveryBootstrap />
      <StartupGate>
        <PreferencesBootstrap />
        <PiHostProjectionBootstrap />
        <PiHostEventBootstrap />
      <SkillsMigrationBootstrap />
        <ExternalCliSessionBootstrap />
        <RunQueueBootstrap />
        <HostAgentQueueBootstrap />
        <SkillCuratorBootstrap />
        <SchedulerBootstrap />
        <WebhookBootstrap />
        <MonitorBootstrap />
        <GatewayBootstrap />
        <PluginTokenRefreshBootstrap />
        <PluginProjectRebindBootstrap />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ProtocolsPage />} />
            <Route path="subdesign/:briefId?" element={<DeferredRoute><SubDesignPage /></DeferredRoute>} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="ops" element={<OpsPage />} />
            <Route path="content-publishing" element={<ContentPublishingPage />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="records" element={<RecordsPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="settings" element={<DeferredRoute><SettingsPage /></DeferredRoute>} />
            <Route path="workspace" element={<Navigate to="/" replace />} />
            <Route path="learning" element={<DeferredRoute><LearningPage /></DeferredRoute>} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="success" element={<SuccessPage />} />
            <Route path="failed" element={<FailedPage />} />
            <Route path="automation" element={<Navigate to="/ops?tab=automation" replace />} />
            <Route path="scheduler" element={<Navigate to="/ops?tab=automation" replace />} />
            <Route path="events" element={<Navigate to="/ops?tab=automation" replace />} />
            <Route path="execution" element={<Navigate to="/ops?tab=execution" replace />} />
            <Route path="archive" element={<Navigate to="/records" replace />} />
            <Route path="logs" element={<Navigate to="/records?tab=logs" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </StartupGate>
    </HashRouter>
  )
}
