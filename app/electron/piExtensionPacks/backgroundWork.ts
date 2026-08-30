import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { piDelegationBridge, type PiDelegatedRunView } from '../piPackBridges.ts'
import { structuredFailure, structuredOk } from './packResults.ts'

/**
 * Background work pack（背景工作包）— delegation and monitoring.
 *
 * The Host already owns child sessions and the run queue; these tools are the
 * model-facing door into them. Every required child property is validated
 * fail-closed through the same `sessions/create` path the protocol uses, so
 * role, profile, context, and depth can never be quietly defaulted.
 */

function delegateArguments(args: Record<string, unknown>) {
  const objective = String(args.objective || '').trim()
  const role = String(args.role || '').trim()
  const profile = args.profile && typeof args.profile === 'object' && !Array.isArray(args.profile) ? args.profile as Record<string, unknown> : undefined
  const depth = Number(args.depth)
  if (!role || !profile || !Number.isFinite(depth)) return { ok: false as const, reason: 'child delegation 需要 role、profile、depth' }
  if (!objective) return { ok: false as const, reason: 'child delegation 需要 objective' }
  return {
    ok: true as const, objective, role, profile, depth,
    facts: Array.isArray(args.facts) ? args.facts.map(String) : [],
    constraints: Array.isArray(args.constraints) ? args.constraints.map(String) : [],
    goalId: typeof args.goalId === 'string' && args.goalId.trim() ? args.goalId.trim() : undefined,
  }
}

async function executeDelegateTask(args: Record<string, unknown>, ctx: Parameters<NonNullable<PiPackTool['execute']>>[1]) {
  const bridge = piDelegationBridge()
  if (!bridge) return structuredFailure('delegation 在此 Host 無法使用')
  const parsed = delegateArguments(args)
  if (!parsed.ok) return structuredFailure(parsed.reason)
  const spawnId = `${ctx.runId || ctx.sessionId}:spawn:${ctx.callId || parsed.objective.slice(0, 48)}`
  try {
    const created = await bridge.spawnChild({
      spawnId, runId: `${ctx.runId || ctx.sessionId}:child:${spawnId}`,
      parentSessionId: ctx.sessionId, parentRunId: String(ctx.runId || ''),
      objective: parsed.objective, role: parsed.role, profile: parsed.profile, depth: parsed.depth,
      context: { objective: parsed.objective, facts: parsed.facts, constraints: parsed.constraints },
      workspace: { mode: 'shared-readonly' },
      ...(parsed.goalId ? { goalId: parsed.goalId } : {}),
    })
    return structuredOk(`已委派給子 session ${created.sessionId}`, {
      childSessionId: created.sessionId, parentSessionId: ctx.sessionId,
      ...('delegationId' in created ? { delegationId: created.delegationId } : {}),
    })
  } catch (error) {
    return structuredFailure(error instanceof Error ? error.message : 'delegation failed')
  }
}

const delegateTask: PiPackTool = {
  name: 'delegate_task',
  label: 'Delegate Task',
  description: 'Split a subtask out to a child agent session',
  promptSnippet: 'delegate a self-contained subtask to a child agent',
  parameters: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'What the child should accomplish' },
      role: { type: 'string', description: 'Child role name' },
      profile: { type: 'object', description: 'Runner/model profile for the child' },
      facts: { type: 'array', items: { type: 'string' }, description: 'Facts the child starts from' },
      constraints: { type: 'array', items: { type: 'string' }, description: 'Constraints binding the child' },
      depth: { type: 'integer', description: 'Delegation depth budget' },
      goalId: { type: 'string', description: 'Optional parent Working State goal to assign by immutable snapshot' },
    },
    required: ['objective', 'role', 'profile', 'depth'],
  },
  approval: () => ({ need: true, reason: 'delegate_task 建立子 agent 並消耗額外執行資源' }),
  execute: executeDelegateTask,
}

const delegateStatus: PiPackTool = {
  name: 'delegate_status',
  label: 'Delegate Status',
  description: 'Report the status of delegated background work',
  promptSnippet: 'check on delegated background work',
  parameters: {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'Optional: one delegated run to inspect' },
    },
  },
  execute: async (args) => {
    const bridge = piDelegationBridge()
    if (!bridge) return structuredFailure('delegation 在此 Host 無法使用')
    const wanted = typeof args.runId === 'string' ? args.runId : undefined
    const runs = bridge.listRuns().filter((run) => !wanted || run.runId === wanted)
    if (wanted && !runs.length) return structuredFailure(`查無背景工作：${wanted}`)
    const lines = runs.length ? runs.map((run: PiDelegatedRunView) => `- ${run.runId}: ${run.status}${run.settlement ? ` (${run.settlement})` : ''}${run.role ? ` [${run.role}]` : ''}`) : ['（目前沒有背景工作）']
    return structuredOk(lines.join('\n'), { runs })
  },
}

const delegateAdoptResults: PiPackTool = {
  name: 'delegate_adopt_results',
  label: 'Adopt Delegated Results',
  description: 'Run the parent Host Checker over terminal delegated goal evidence and commit accepted goals',
  promptSnippet: 'adopt completed delegated goal results through the parent checker',
  parameters: { type: 'object', properties: {} },
  // This writes the canonical parent Working State. The resume fence must
  // therefore treat it as a mutation, even though it performs no file I/O.
  policyMigration: { sideEffect: true },
  execute: async (_args, ctx) => {
    const bridge = piDelegationBridge()
    if (!bridge) return structuredFailure('delegation 在此 Host 無法使用')
    bridge.requestGoalAdoption(ctx.sessionId)
    return structuredOk('已排入 parent Checker，將在本 step 所有 sibling effects settled 後仲裁', { adoptionRequested: true })
  },
}

const monitor: PiPackTool = {
  name: 'monitor',
  label: 'Monitor',
  description: 'Summarize everything this Host is running in the background',
  promptSnippet: 'summarize all background activity of this host',
  parameters: { type: 'object', properties: {} },
  execute: async () => {
    const bridge = piDelegationBridge()
    const runs = bridge?.listRuns() || []
    const queued = runs.filter((run) => run.status === 'queued').length
    const active = runs.filter((run) => run.status === 'claimed').length
    return structuredOk(
      `背景工作：${runs.length} 項（排隊 ${queued}、進行中 ${active}）`,
      { total: runs.length, queued, active },
    )
  },
}



export function buildBackgroundWorkPack() {
  return {
    id: 'background-work',
    name: 'Background Work',
    description: 'Sub-agent delegation and background monitoring',
    capability: 'delegate',
    tools: [delegateTask, delegateStatus, delegateAdoptResults, monitor],
  }
}

let registered = false
export function ensureBackgroundWorkPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildBackgroundWorkPack())
}
