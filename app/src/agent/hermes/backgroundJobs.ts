/**
 * Background delegate jobs + notify_on_complete
 * Hermes Phase 5: fire-and-forget leaf tasks with desktop notification
 */

import type { ArchiveRecord, LlmSettings, ToolCallRecord } from '../types'
import {
  runDelegatedTask,
  type DelegateTaskInput,
  type DelegateTaskResult,
  type DelegationBudget,
  globalDelegationBudget,
} from './delegate'

/**
 * Phase 3 item 6: durable background job completion.
 * - Coordinator path: execution Archive already written under job.archiveRunId;
 *   only inject parent completion + keep job metadata (no second Archive).
 * - Nested FC path (preferRunTask=false): write a single synthetic execution Archive.
 */
async function archiveBackgroundJob(
  job: BackgroundJob,
  toolCalls?: ToolCallRecord[],
): Promise<void> {
  try {
    if (job.archiveRunId) {
      // Link-only: coordinator finalization already archived the execution.
      // Optionally refresh list so Records shows the linked run id promptly.
      try {
        const { useAgentStore } = await import('../../store/agentStore')
        await useAgentStore.getState().loadArchive()
      } catch {
        /* ignore */
      }
    } else {
      const record: ArchiveRecord = {
        id: `bg_${job.id}`,
        status: job.ok ? 'success' : 'failed',
        objective: `[background-delegate] ${job.goal}`,
        loopType: 'Goal-based',
        confidence: job.ok ? 0.85 : 0.3,
        timestamp: job.finishedAt || new Date().toISOString(),
        iterations: 1,
        maxIterations: 1,
        steps: [
          {
            step: 1,
            action: 'delegate_task',
            description: 'Background leaf delegate',
            status: job.ok ? 'COMPLETED' : 'FAILED',
            result: (job.summary || job.error || '').slice(0, 4000),
            durationMs: job.durationMs,
          },
        ],
        logs: [],
        result: job.summary || job.error,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        tokensUsed: job.tokensUsed,
      }
      if (window.subagents?.archive?.save) {
        await window.subagents.archive.save(record)
        try {
          const { useAgentStore } = await import('../../store/agentStore')
          await useAgentStore.getState().loadArchive()
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* non-fatal */
  } finally {
    await injectBackgroundResult(job)
  }
}

/**
 * Hermes-style completion queue handoff: when the originating thread is
 * genuinely idle, append a fresh system turn instead of hiding the result in
 * Records. Busy threads are left alone so an active conversation is never
 * interrupted; the archive and desktop notification remain the fallback.
 */
async function injectBackgroundResult(job: BackgroundJob): Promise<void> {
  if (!job.parentThreadId) return
  try {
    const [{ useAgentStore }, { useThreadStore }, { queueLength }] = await Promise.all([
      import('../../store/agentStore'),
      import('../../store/threadStore'),
      import('../runQueue'),
    ])
    const agent = useAgentStore.getState()
    const threads = useThreadStore.getState()
    if (!agent.canStartRun().allowed || queueLength() > 0) return
    if (threads.runningThreadIds.includes(job.parentThreadId)) return
    if (!threads.threads.some((thread) => thread.id === job.parentThreadId)) return

    const title = job.ok ? '背景委派完成' : '背景委派失敗'
    const detail = (job.summary || job.error || '沒有摘要').trim().slice(0, 6000)
    useThreadStore.getState().pushBubble(
      job.parentThreadId,
      'system',
      `${title} · ${job.id}\n目標：${job.goal.slice(0, 240)}\n\n結果摘要：\n${detail}`,
    )
  } catch {
    /* Thread injection is additive; archive persistence must still succeed. */
  }
}

export type BackgroundJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

export interface BackgroundJob {
  id: string
  goal: string
  status: BackgroundJobStatus
  notifyOnComplete: boolean
  summary?: string
  ok?: boolean
  startedAt: string
  finishedAt?: string
  durationMs?: number
  tokensUsed?: number
  depth?: number
  error?: string
  /** Original conversation that requested this background delegate. */
  parentThreadId?: string
  /**
   * Phase 3 item 6: when the job ran through coordinator/runTask, this is the
   * execution Archive id — synthetic job record must not write a second Archive.
   */
  archiveRunId?: string
}

type JobListener = (job: BackgroundJob) => void

const jobs = new Map<string, BackgroundJob>()
const listeners = new Set<JobListener>()
const MAX_JOBS = 50

export function subscribeBackgroundJobs(fn: JobListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(job: BackgroundJob) {
  for (const fn of listeners) {
    try {
      fn({ ...job })
    } catch {
      /* ignore */
    }
  }
}

function trimJobs() {
  if (jobs.size <= MAX_JOBS) return
  const sorted = [...jobs.values()].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  )
  while (sorted.length > MAX_JOBS) {
    const old = sorted.shift()
    if (old) jobs.delete(old.id)
  }
}

async function notifyDesktop(title: string, body: string) {
  try {
    if (window.subagents?.notify) {
      await window.subagents.notify(title, body)
    }
  } catch {
    /* ignore */
  }
}

/**
 * Queue a delegated task to run in the background.
 * Returns immediately with job id; completion fires notify + listeners.
 */
export function enqueueBackgroundDelegate(
  settings: LlmSettings,
  input: DelegateTaskInput & { notifyOnComplete?: boolean },
  opts?: {
    budget?: DelegationBudget
    onLog?: (msg: string) => void
    shouldAbort?: () => boolean
    /**
     * Prefer unified runTask controller when free (queue when busy).
     * Nested FC still uses runDelegatedTask; background goes through runTask.
     */
    preferRunTask?: boolean
  },
): BackgroundJob {
  const notifyOnComplete = input.notifyOnComplete !== false
  const provisionalId = `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  if (settings.subAgentsEnabled !== true) {
    return {
      id: provisionalId,
      goal: input.goal,
      status: 'failed',
      notifyOnComplete,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ok: false,
      error: 'Sub Agent 功能目前已關閉，背景委派未排入。',
      summary: 'Sub Agent 功能目前已關閉，背景委派未排入。',
      durationMs: 0,
      tokensUsed: 0,
      depth: 0,
    }
  }
  const job: BackgroundJob = {
    id: provisionalId,
    goal: input.goal,
    status: 'queued',
    notifyOnComplete,
    startedAt: new Date().toISOString(),
    parentThreadId: input.parentThreadId,
  }
  jobs.set(job.id, job)
  trimJobs()
  emit(job)

  void (async () => {
    job.status = 'running'
    emit(job)
    opts?.onLog?.(
      `[bg ${job.id}] 背景委派啟動：${input.goal.slice(0, 80)}` +
        (input.inheritCapabilities?.length
          ? ` · inherit=[${input.inheritCapabilities.join(',')}]`
          : '') +
        (input.projectRoot ? ` · project=${input.projectRoot}` : ''),
    )

    try {
      let result: DelegateTaskResult
      const preferRunTask = opts?.preferRunTask !== false
      const childRunId = `bg_${provisionalId}`
      const inherited = {
        goal: input.goal,
        context: input.context,
        role: (input.role || 'leaf') as 'leaf' | 'orchestrator',
        maxRounds: input.maxRounds,
        inheritCapabilities: input.inheritCapabilities,
        parentRunId: input.parentRunId,
        parentThreadId: input.parentThreadId,
        sourceKind: input.sourceKind || 'delegate',
        projectRoot: input.projectRoot,
        parentPermissionPolicy: input.parentPermissionPolicy,
        parentPermissionProjection: input.parentPermissionProjection,
        parentMcpAgentId: input.parentMcpAgentId,
      }

      if (preferRunTask) {
        // Unified runTask: queue when busy, same hooks/project pin/settle semantics.
        // Phase 3 item 6/7: hidden worker thread + single coordinator Archive.
        const { runTask } = await import('../taskRunCoordinator')
        type ExternalRunResult = Awaited<ReturnType<typeof runTask>>
        const settled = await new Promise<ExternalRunResult>((resolve) => {
          void runTask({
            sourceKind: 'delegate',
            runId: childRunId,
            objective: input.goal,
            title: `委派 · ${input.goal.slice(0, 32)}`,
            sourceLabel: `背景委派${input.parentRunId ? ` · parent=${input.parentRunId}` : ''}`,
            projectRoot: input.projectRoot,
            unattended: true,
            enqueueWhenBusy: true,
            workerThread: true,
            skipUserBubble: true,
            overrides: {
              runId: childRunId,
              sourceKind: 'delegate',
              projectRoot: input.projectRoot,
              preloadCapabilityIds: input.inheritCapabilities,
              maxToolRounds: input.maxRounds || 3,
              extraSystemContext: input.context
                ? `## 父層唯讀上下文\n${input.context.slice(0, 3000)}`
                : undefined,
              unattended: true,
              hitlTimeoutMs: 45_000,
              permissionPolicy: input.parentPermissionPolicy,
              permissionProjection: input.parentPermissionProjection,
              mcpAgentId: input.parentMcpAgentId,
            },
            onSettled: (r) => resolve(r),
          }).then((r) => {
            if (!r.queued) resolve(r)
            else {
              job.status = 'queued'
              emit(job)
              // drain will call onSettled
            }
          })
        })
        // Link job metadata to the coordinator execution archive (no second write).
        job.archiveRunId = settled.runId || childRunId
        result = {
          id: settled.runId || childRunId,
          role: inherited.role,
          goal: input.goal,
          ok: settled.status === 'success',
          summary: settled.result || settled.error || `status=${settled.status}`,
          tokensUsed: 0,
          toolCalls: [],
          durationMs: Date.now() - new Date(job.startedAt).getTime(),
          depth: 1,
        }
      } else {
        result = await runDelegatedTask(settings, inherited, {
          budget: opts?.budget || globalDelegationBudget,
          onLog: opts?.onLog,
          shouldAbort: opts?.shouldAbort,
        })
      }

      // Align job id with delegate id for correlation
      if (result.id && result.id !== job.id) {
        jobs.delete(job.id)
        job.id = result.id
        jobs.set(job.id, job)
      }

      job.ok = result.ok
      job.status = result.ok ? 'success' : 'failed'
      job.summary = result.summary
      job.durationMs = result.durationMs
      job.tokensUsed = result.tokensUsed
      job.depth = result.depth
      job.parentThreadId = input.parentThreadId
      job.finishedAt = new Date().toISOString()
      if (!result.ok) job.error = result.summary

      if (notifyOnComplete) {
        await notifyDesktop(
          result.ok ? 'SubAgents AI · 委派完成' : 'SubAgents AI · 委派失敗',
          `${input.goal.slice(0, 60)}\n${(result.summary || '').slice(0, 120)}`,
        )
      }
      opts?.onLog?.(
        `[bg ${job.id}] 完成 status=${job.status} ${result.durationMs}ms`,
      )
      // G6: persist finished background jobs into Archive (survive app restart)
      void archiveBackgroundJob(job, result.toolCalls)
    } catch (e) {
      job.status = 'failed'
      job.ok = false
      job.error = e instanceof Error ? e.message : String(e)
      job.summary = job.error
      job.finishedAt = new Date().toISOString()
      if (notifyOnComplete) {
        await notifyDesktop('SubAgents AI · 委派失敗', job.error.slice(0, 160))
      }
      void archiveBackgroundJob(job)
    }
    emit(job)
  })()

  return { ...job }
}

/**
 * G10(grok `wait_commands_or_subagents`):一次等多個背景 job。
 * `wait_any` 第一個到達終態即返回;`wait_all` 全部終態才返回。
 * 逾時回 timedOut=true 並附當下快照 —— 呼叫端不阻塞、不輪詢。
 */
export async function waitBackgroundJobs(
  ids: string[],
  mode: 'wait_any' | 'wait_all' = 'wait_all',
  timeoutMs = 30_000,
): Promise<{ timedOut: boolean; jobs: BackgroundJob[] }> {
  const wanted = [...new Set(ids.map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 20)
  const isTerminal = (j?: BackgroundJob) =>
    Boolean(j && (j.status === 'success' || j.status === 'failed' || j.status === 'cancelled'))
  const snapshot = () =>
    wanted
      .map((id) => jobs.get(id))
      .filter((j): j is BackgroundJob => Boolean(j))
      .map((j) => ({ ...j }))
  const done = () => {
    if (!wanted.length) return true
    const list = wanted.map((id) => jobs.get(id))
    return mode === 'wait_any' ? list.some(isTerminal) : list.every(isTerminal)
  }
  if (done()) return { timedOut: false, jobs: snapshot() }
  return new Promise((resolve) => {
    let settled = false
    const finish = (timedOut: boolean) => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(timer)
      resolve({ timedOut, jobs: snapshot() })
    }
    const unsubscribe = subscribeBackgroundJobs(() => {
      if (done()) finish(false)
    })
    const timer = setTimeout(
      () => finish(true),
      Math.max(1_000, Math.min(timeoutMs, 120_000)),
    )
  })
}

export function listBackgroundJobs(): BackgroundJob[] {
  return [...jobs.values()].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
}

export function getBackgroundJob(id: string): BackgroundJob | undefined {
  const j = jobs.get(id)
  return j ? { ...j } : undefined
}

export function clearFinishedBackgroundJobs(): number {
  let n = 0
  for (const [id, j] of jobs) {
    if (j.status === 'success' || j.status === 'failed' || j.status === 'cancelled') {
      jobs.delete(id)
      n += 1
    }
  }
  return n
}
