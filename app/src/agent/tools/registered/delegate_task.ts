/**
 * Self-registering tool module: delegate_task
 * Hermes-style import-time register(). I/O lives here (no central switch).
 * Nested admission only via runTask (spawnDelegateViaRunTask).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "delegate_task",
  toolset: "delegate",
  description: "Spawn isolated leaf subagent with separate context (supports background + notify)",
  keywords: ["delegate","subagent","parallel","spawn","isolate","background"],
  schemaParams: {"type":"object","properties":{"goal":{"type":"string"},"context":{"type":"string"},"role":{"type":"string","enum":["leaf","orchestrator"]},"background":{"type":"boolean","description":"If true, return immediately and run in background"},"notify_on_complete":{"type":"boolean","description":"Desktop notification when background job finishes (default true)"},"inherit_capabilities":{"type":"array","items":{"type":"string"},"description":"Capability ids to preload in child (e.g. codegraph, workspace). Explicit inherit only."},"persona":{"type":"string","description":"Named delegate persona from settings"},"capability_mode":{"type":"string","enum":["read-only","read-write","execute","all"]},"isolation":{"type":"string","enum":["none","worktree"]}},"required":["goal"]} as Record<string, unknown>,
  owningCapability: "delegate",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
      const { useSettingsStore } = await import('../../../store/settingsStore.ts')
      const settings = useSettingsStore.getState().settings
      if (settings.subAgentsEnabled !== true) {
        return { ok: false, output: 'Sub Agent 功能目前已關閉，請到設定 → 角色模型開啟。' }
      }
      const goal = String(input.goal || '').trim()
      if (!goal) return { ok: false, output: 'goal is required' }
      const background =
        input.background === true ||
        input.background === 'true' ||
        input.background === 1
      const notifyOnComplete =
        input.notify_on_complete !== false &&
        input.notifyOnComplete !== false &&
        input.notify_on_complete !== 'false'

      const inheritRaw =
        input.inherit_capabilities ?? input.inheritCapabilities ?? input.capabilities
      const inheritCapabilities = Array.isArray(inheritRaw)
        ? inheritRaw.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12)
        : typeof inheritRaw === 'string'
          ? inheritRaw
              .split(/[,;\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 12)
          : []

      const capabilityModeRaw = String(input.capability_mode || input.capabilityMode || '').trim()
      type CapMode = 'read-only' | 'read-write' | 'execute' | 'all'
      const capabilityMode: CapMode | undefined =
        capabilityModeRaw === 'read-only' ||
        capabilityModeRaw === 'read-write' ||
        capabilityModeRaw === 'execute' ||
        capabilityModeRaw === 'all'
          ? (capabilityModeRaw as CapMode)
          : undefined

      const isolationRaw = String(input.isolation || '').trim()
      const isolation = isolationRaw === 'worktree' ? 'worktree' as const : 'none' as const

      const parentCtx = {
        parentRunId: runId,
        parentThreadId: threadId,
        projectRoot: projectRoot || context?.projectRoot,
        sourceKind: 'delegate' as const,
        inheritCapabilities,
        capabilityMode,
        persona: input.persona ? String(input.persona) : undefined,
        isolation,
        parentPermissionPolicy: context?.permissionPolicy,
        parentPermissionProjection: context?.permissionProjection,
        parentMcpAgentId: context?.mcpAgentId,
      }

      if (background) {
        const { enqueueBackgroundDelegate } = await import('../../hermes/backgroundJobs')
        const job = enqueueBackgroundDelegate(settings, {
          goal,
          context: input.context ? String(input.context) : undefined,
          role: input.role === 'orchestrator' ? 'orchestrator' : 'leaf',
          background: true,
          notifyOnComplete,
          ...parentCtx,
        })
        return {
          ok: true,
          output: `背景委派已排入佇列：${job.id}\n目標：${goal}${inheritCapabilities.length ? `\ninherit: ${inheritCapabilities.join(', ')}` : ''}\n完成時${notifyOnComplete ? '會' : '不會'}桌面通知。可用 delegate_status 查詢。`,
          data: job,
        }
      }

      // Always Task run admission (+ G9 prepare inside spawnDelegateViaRunTask)
      const { spawnDelegateViaRunTask } = await import('../../hermes/delegate')
      const r = await spawnDelegateViaRunTask(settings, {
        goal,
        context: input.context ? String(input.context) : undefined,
        role: input.role === 'orchestrator' ? 'orchestrator' : 'leaf',
        ...parentCtx,
      })
      return {
        ok: r.ok,
        output: r.ok
          ? `委派完成（via runTask · ${r.id}）\n\n${String(r.summary).slice(0, 4000)}`
          : `委派失敗：${String(r.summary).slice(0, 2000)}`,
        data: r,
      }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
