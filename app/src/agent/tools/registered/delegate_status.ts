/**
 * Self-registering tool module: delegate_status
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "delegate_status",
  toolset: "delegate",
  description: "List or query background delegate jobs",
  keywords: ["delegate","status","background","job","notify"],
  schemaParams: {"type":"object","properties":{"jobId":{"type":"string","description":"Optional job id; omit to list recent jobs"},"jobIds":{"type":"array","items":{"type":"string"},"description":"Job ids to wait on (max 20); used with wait"},"wait":{"type":"string","enum":["none","any","all"],"description":"Block until jobs finish: any = first terminal job returns; all = every job terminal. Default none (snapshot only). Never poll in a loop — use this instead."},"timeoutMs":{"type":"number","description":"Max wait in ms (default 30000, cap 120000)"}}} as Record<string, unknown>,
  owningCapability: "delegate",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    if (useSettingsStore.getState().settings.subAgentsEnabled !== true) {
      return { ok: false, output: 'Sub Agent 功能目前已關閉，沒有可用的 delegate job。' }
    }
    const { listBackgroundJobs, getBackgroundJob, waitBackgroundJobs } = await import(
      '../../hermes/backgroundJobs'
    )
    // G10:wait=any/all 阻塞等待多個 job 終態(取代模型自行輪詢)
    const waitMode = String(input.wait || 'none')
    if (waitMode === 'any' || waitMode === 'all') {
      const ids = Array.isArray(input.jobIds)
        ? input.jobIds.map(String)
        : input.jobId
          ? [String(input.jobId)]
          : listBackgroundJobs()
              .filter((j) => j.status === 'queued' || j.status === 'running')
              .map((j) => j.id)
      if (!ids.length) return { ok: true, output: '（沒有進行中的背景委派可等待）' }
      const r = await waitBackgroundJobs(
        ids,
        waitMode === 'any' ? 'wait_any' : 'wait_all',
        Number(input.timeoutMs) || 30_000,
      )
      return {
        ok: true,
        output: [
          r.timedOut ? `等待逾時（${ids.length} 個 job 未全部完成）` : '等待完成',
          ...r.jobs.map(
            (j) =>
              `· ${j.id} [${j.status}] ${j.goal.slice(0, 60)}${j.summary ? ` — ${j.summary.slice(0, 120)}` : ''}`,
          ),
        ].join('\n'),
        data: r,
      }
    }
    const jobId = input.jobId ? String(input.jobId) : ''
    if (jobId) {
      const j = getBackgroundJob(jobId)
      if (!j) return { ok: false, output: `找不到 job：${jobId}` }
      return {
        ok: true,
        output: JSON.stringify(j, null, 2),
        data: j,
      }
    }
    const list = listBackgroundJobs().slice(0, 20)
    if (!list.length) return { ok: true, output: '（無背景委派任務）' }
    return {
      ok: true,
      output: list
        .map(
          (j) =>
            `· ${j.id} [${j.status}] ${j.goal.slice(0, 60)}${j.summary ? ` — ${j.summary.slice(0, 80)}` : ''}`,
        )
        .join('\n'),
      data: list,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
