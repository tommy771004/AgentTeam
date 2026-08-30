import { useAgentStore } from '../store/agentStore.ts'
import { runTask } from './taskRunCoordinator.ts'
import type { PiTurnSettlement } from './piHostRun.ts'
import { buildExternalCliDelegateContract, RUNNER_IDS, type RunnerId } from './runners/types.ts'

type ClaimedRun = {
  runId: string
  sessionId: string
  prompt: string
  profile: Record<string, unknown>
  trigger: 'interactive' | 'time' | 'proactive'
}

function asClaimedRun(value: unknown): ClaimedRun | undefined {
  if (!value || typeof value !== 'object') return undefined
  const run = value as Record<string, unknown>
  if (typeof run.runId !== 'string' || typeof run.sessionId !== 'string' || typeof run.prompt !== 'string') return undefined
  const trigger = run.trigger === 'interactive' || run.trigger === 'time' || run.trigger === 'proactive' ? run.trigger : undefined
  if (!trigger) return undefined
  return { runId: run.runId, sessionId: run.sessionId, prompt: run.prompt, profile: run.profile && typeof run.profile === 'object' ? run.profile as Record<string, unknown> : {}, trigger }
}

function attachments(profile: Record<string, unknown>) {
  if (!Array.isArray(profile.attachments)) return []
  return profile.attachments.filter((value): value is import('./types.ts').ChatAttachment => {
    if (!value || typeof value !== 'object') return false
    const item = value as Record<string, unknown>
    return typeof item.id === 'string' && (item.kind === 'image' || item.kind === 'text' || item.kind === 'binary')
      && typeof item.name === 'string' && typeof item.mimeType === 'string' && typeof item.size === 'number'
  })
}

function settlementFor(status: string): PiTurnSettlement {
  if (status === 'success') return 'answered'
  if (status === 'halted') return 'interrupted'
  return 'failed'
}

function runnerFromProfile(profile: Record<string, unknown>): RunnerId {
  const requested = typeof profile.runner === 'string' ? profile.runner : 'builtin'
  return (RUNNER_IDS as readonly string[]).includes(requested) ? requested as RunnerId : 'builtin'
}

function thinkingDepth(profile: Record<string, unknown>): 'fast' | 'standard' | 'deep' | 'max' | undefined {
  const value = profile.thinkingLevel
  if (value === 'off' || value === 'minimal' || value === 'low') return 'fast'
  if (value === 'medium') return 'standard'
  if (value === 'high') return 'deep'
  if (value === 'xhigh' || value === 'max') return 'max'
  return undefined
}

function agentMode(profile: Record<string, unknown>): 'build' | 'plan' | undefined {
  return profile.agentMode === 'build' || profile.agentMode === 'plan' ? profile.agentMode : undefined
}

/**
 * Event-driven renderer adapter: the Host owns admission/queue/lifecycle;
 * runTask remains the sole renderer execution coordinator.
 */
export function startHostAgentQueuePump(): () => void {
  const api = window.subagents?.piHost
  if (!api?.runs?.claim || !api.runs.settle) return () => undefined
  let disposed = false
  let pumping = false
  let scheduled = false

  const wake = () => {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      void pump()
    })
  }

  const pump = async () => {
    if (disposed || pumping || !useAgentStore.getState().canStartRun().allowed) return
    pumping = true
    let claimed: ClaimedRun | undefined
    try {
      const listed = await api.runs.list()
      if (!Array.isArray(listed.queue) || !listed.queue.some((run) => (
        run && typeof run === 'object' && (run as { status?: unknown }).status === 'queued'
      ))) return
      // Let the Host select the first claimable item. It skips an active
      // session without blocking ready work queued for other sessions.
      const response = await api.runs.claim()
      claimed = asClaimedRun(response.run)
      if (!claimed) return
      const profile = claimed.profile
      const runner = runnerFromProfile(profile)
      const projectRoot = typeof profile.projectRoot === 'string' ? profile.projectRoot : undefined
      const interactiveThreadId = claimed.trigger === 'interactive' && typeof profile.threadId === 'string'
        ? profile.threadId
        : undefined
      const result = await runTask({
        sourceKind: interactiveThreadId ? 'queue-drain' : 'delegate',
        runId: claimed.runId,
        objective: claimed.prompt,
        runner,
        title: interactiveThreadId ? claimed.prompt.slice(0, 48) : `Agent · ${claimed.prompt.slice(0, 36)}`,
        sourceLabel: interactiveThreadId ? 'Host 佇列 · 開始執行' : `Host Agent ${claimed.sessionId}`,
        unattended: profile.unattended === true,
        workerThread: !interactiveThreadId,
        ...(interactiveThreadId ? { reuseThreadId: interactiveThreadId, attachments: attachments(profile) } : {}),
        skipUserBubble: true,
        projectRoot,
        _fromQueue: true,
        overrides: {
          runId: claimed.runId,
          sourceKind: 'delegate',
          hostSessionId: claimed.sessionId,
          model: typeof profile.model === 'string' ? profile.model : undefined,
          thinkingDepth: thinkingDepth(profile),
          speed: profile.speed === 'fast' || profile.speed === 'standard' || profile.speed === 'careful' ? profile.speed : undefined,
          providerServiceTier: profile.providerServiceTier === 'provider-default' || profile.providerServiceTier === 'standard' || profile.providerServiceTier === 'priority' || profile.providerServiceTier === 'flex' ? profile.providerServiceTier : undefined,
          agentMode: agentMode(profile),
          planCompletionAction: profile.planCompletionAction === 'wait_for_user' || profile.planCompletionAction === 'auto_start_build' ? profile.planCompletionAction : undefined,
          approvalMode: profile.approvalMode === 'always' || profile.approvalMode === 'auto' || profile.approvalMode === 'full' ? profile.approvalMode : undefined,
          unattended: profile.unattended === true,
          preloadCapabilityIds: Array.isArray(profile.capabilities) ? profile.capabilities.map(String) : undefined,
          temporary: true,
          contextPolicySnapshot: {
            memoryEnabled: false,
            memoryWriteEnabled: false,
            referenceChatHistory: false,
            temporary: true,
            project: projectRoot,
            outboundShellMode: profile.outbound === 'off' || profile.outbound === 'demo' || profile.outbound === 'optional' || profile.outbound === 'required' ? profile.outbound : 'off',
          },
          externalCliContract: runner === 'builtin' ? undefined : buildExternalCliDelegateContract({ role: 'leaf', unattended: profile.unattended === true }),
        },
      })
      await api.runs.settle(claimed.runId, settlementFor(result.status))
    } catch {
      if (claimed) {
        try { await api.runs.settle(claimed.runId, 'failed') } catch { /* Host may already have settled it */ }
      }
    } finally {
      pumping = false
      if (claimed) wake()
    }
  }

  const unsubscribeEvent = api.onEvent?.((event) => {
    if (event.event === 'host/agent-collaboration' || event.event === 'host/agent-lifecycle') wake()
  })
  const unsubscribeAgent = useAgentStore.subscribe((state, previous) => {
    if (state.activeRunIds.length < previous.activeRunIds.length) wake()
  })
  wake()
  return () => {
    disposed = true
    unsubscribeEvent?.()
    unsubscribeAgent()
  }
}
