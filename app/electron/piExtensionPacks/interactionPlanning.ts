import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { getPiLivePlan, setPiContinuationItems, setPiLivePlan, setPiPlanGateCandidate, type PiPlanStep } from '../piPackBridges.ts'
import { normalizeContinuationItems } from '../../src/agent/continuation.ts'

/**
 * Interaction and planning pack（互動與計畫包）.
 *
 * ask_user raises the SAME HITL prompt as any other approval — the question
 * travels out on host/approval-requested, waits the same budget, auto-denies
 * under the unattended policy instead of stalling forever. The user's answer
 * rides back inside the resolution as the tool result.
 *
 * update_plan drives the plan panel the user watches: one live snapshot per
 * session, announced by an event, and recorded as a notice entry so a
 * finished run replays exactly what the agent intended at each point.
 */

export type PiPlanAnnouncement = { sessionId: string; runId?: string; steps: PiPlanStep[] }

let announcePlan: ((announcement: PiPlanAnnouncement) => void) | undefined

/** The protocol installs this so plan updates reach the UI channel. */
export function setPiPlanAnnouncer(announce: (announcement: PiPlanAnnouncement) => void): void {
  announcePlan = announce
}

const VALID_STATUS = new Set(['pending', 'in_progress', 'done', 'failed'])

const askUser: PiPackTool = {
  name: 'ask_user',
  label: 'Ask User',
  description: 'Ask the user a question and wait for their answer',
  promptSnippet: 'ask the user a clarifying question and wait',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'What to ask' },
      context: { type: 'string', description: 'Optional background for the question' },
      options: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 12,
        description: 'Optional choices the user can pick from; omit to request a free-text answer',
      },
      multiSelect: { type: 'boolean', description: 'Allow picking several options (default false)' },
      allowFreeform: { type: 'boolean', description: 'Allow a free-text answer alongside the options (default true)' },
    },
    required: ['question'],
  },
  // The question IS an approval-shaped ask; unattended runs refuse it after
  // their timeout rather than waiting out a person who is not there. hitl
  // makes it surface even under complete/full access: asking the user is the
  // tool's whole purpose, so no policy may silently auto-answer it.
  approval: () => ({ need: true, reason: 'ask_user 等待使用者回覆', hitl: true }),
  execute: async (args) => {
    const question = String(args.question || '').trim()
    if (!question) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'question 必填' }) }], details: { ok: false, error: 'question 必填' } }
    // Reaching execute means the user answered allow (possibly with text).
    const answer = String((args as Record<string, unknown>).answer ?? '')
    return {
      content: [{ type: 'text', text: answer ? `使用者回答：${answer}` : '使用者已確認（無文字回覆）' }],
      details: { ok: true, question, ...(answer ? { answer } : {}) },
    }
  },
}

function normalizeSteps(raw: unknown): PiPlanStep[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const steps: PiPlanStep[] = []
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const title = String(candidate.title || '').trim()
    if (!title) continue
    const status = VALID_STATUS.has(String(candidate.status || '')) ? String(candidate.status) as PiPlanStep['status'] : 'pending'
    const meta = String(candidate.meta || '').trim().slice(0, 80)
    const details = Array.isArray(candidate.details)
      ? candidate.details.slice(0, 8).flatMap((raw) => {
          if (!raw || typeof raw !== 'object') return []
          const detail = raw as Record<string, unknown>
          const label = String(detail.label || '').trim().slice(0, 200)
          if (!label) return []
          const detailMeta = String(detail.meta || '').trim().slice(0, 80)
          return [{ label, ...(detailMeta ? { meta: detailMeta } : {}) }]
        })
      : []
    steps.push({
      id: String(candidate.id || `step-${steps.length + 1}`).slice(0, 80),
      title: title.slice(0, 400),
      status,
      ...(meta ? { meta } : {}),
      ...(details.length ? { details } : {}),
    })
  }
  return steps.length ? steps : undefined
}

const updatePlan: PiPackTool = {
  name: 'update_plan',
  label: 'Update Plan',
  description: 'Publish or update the visible task plan',
  promptSnippet: 'publish the step-by-step plan the user sees',
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: 'Full plan state; send every step each time with its current status.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'failed'] },
            meta: { type: 'string', description: 'Optional short value shown on the task row, such as "2 files".' },
            details: {
              type: 'array',
              maxItems: 8,
              description: 'Optional child steps shown when the user expands this task row.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  meta: { type: 'string' },
                },
                required: ['label'],
              },
            },
          },
          required: ['title'],
        },
      },
    },
    required: ['steps'],
  },
  execute: async (args, ctx) => {
    const steps = normalizeSteps(args.steps)
    if (!steps) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'steps 必須至少包含一個帶 title 的步驟' }) }], details: { ok: false, error: 'steps invalid' } }
    setPiLivePlan(ctx.sessionId, steps)
    announcePlan?.({ sessionId: ctx.sessionId, runId: ctx.runId, steps })
    return {
      content: [{ type: 'text', text: `計畫已更新（${steps.length} 個步驟）` }],
      details: { ok: true, steps },
    }
  },
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 500))
    .slice(0, limit)
}

const completePlan: PiPackTool = {
  name: 'complete_plan',
  label: 'Complete Plan',
  description: 'Submit a structured implementation plan to the Host Plan Gate',
  promptSnippet: 'submit the completed plan to the Host gate before implementation begins',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Short statement of the planned implementation' },
      steps: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      acceptanceCriteria: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      unresolvedQuestions: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      requiresAdditionalAuthority: { type: 'boolean' },
    },
    required: ['summary', 'steps', 'acceptanceCriteria', 'unresolvedQuestions', 'requiresAdditionalAuthority'],
  },
  execute: async (args, ctx) => {
    if (!ctx.runId) {
      return {
        content: [{ type: 'text', text: 'Plan Gate 拒絕：缺少 Host run identity。' }],
        details: { ok: false, gate: 'missing-run' },
      }
    }
    const summary = String(args.summary || '').trim().slice(0, 1_000)
    const steps = stringList(args.steps, 20)
    const acceptanceCriteria = stringList(args.acceptanceCriteria, 20)
    const unresolvedQuestions = stringList(args.unresolvedQuestions, 12)
    const requiresAdditionalAuthority = args.requiresAdditionalAuthority === true
    if (!summary || steps.length === 0 || acceptanceCriteria.length === 0) {
      return {
        content: [{ type: 'text', text: 'Plan Gate 拒絕：summary、steps、acceptanceCriteria 都必須完整。' }],
        details: { ok: false, gate: 'incomplete' },
      }
    }
    setPiPlanGateCandidate(ctx.sessionId, {
      runId: ctx.runId,
      summary,
      steps,
      acceptanceCriteria,
      unresolvedQuestions,
      requiresAdditionalAuthority,
    })
    const ready = unresolvedQuestions.length === 0 && !requiresAdditionalAuthority
    return {
      content: [{
        type: 'text',
        text: ready
          ? 'Plan Gate candidate 已提交；Host 將在此回合 settlement 後驗證。'
          : 'Plan Gate candidate 已提交，但仍有未決問題或需要額外權限，Host 不會自動進入 Build。',
      }],
      details: { ok: true, ready, unresolvedQuestions, requiresAdditionalAuthority },
    }
  },
}

const recordContinuationItems: PiPackTool = {
  name: 'record_continuation_items',
  label: 'Record Continuation Items',
  description: 'Replace the Host-owned backlog of implementation or improvement items for the next internal iteration',
  promptSnippet: 'record concrete remaining work before an unfinished Goal-based iteration settles',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            acceptanceCriteria: { type: 'array', items: { type: 'string' }, maxItems: 16 },
            priority: { type: 'number' },
            dependencies: { type: 'array', items: { type: 'string' }, maxItems: 16 },
            scope: { type: 'string', enum: ['original-objective', 'expanded'] },
            requiresAdditionalAuthority: { type: 'boolean' },
            status: { type: 'string', enum: ['candidate', 'running', 'completed', 'blocked', 'discarded'] },
          },
          required: ['id', 'title', 'description', 'acceptanceCriteria', 'scope', 'requiresAdditionalAuthority', 'status'],
        },
      },
    },
    required: ['items'],
  },
  execute: async (args, ctx) => {
    if (!ctx.runId) return { content: [{ type: 'text', text: '續行清單拒絕：缺少 Host run identity。' }], details: { ok: false } }
    const items = normalizeContinuationItems(args.items)
    if (Array.isArray(args.items) && args.items.length > 0 && items.length === 0) {
      return { content: [{ type: 'text', text: '續行清單拒絕：沒有完整且可驗證的項目。' }], details: { ok: false } }
    }
    setPiContinuationItems(ctx.sessionId, ctx.runId, items)
    return {
      content: [{ type: 'text', text: `續行清單已記錄（${items.length} 項）；Host 會在 iteration settlement 後決定是否直接續行。` }],
      details: { ok: true, items },
    }
  },
}

/** The current plan for a session, for projections that read it directly. */
export function piCurrentPlan(sessionId: string): PiPlanStep[] | undefined {
  return getPiLivePlan(sessionId)
}

export function buildInteractionPlanningPacks() {
  return [
    {
      id: 'interaction-pack',
      name: 'Interaction',
      description: 'Human-in-the-loop questions through the shared HITL path',
      capability: 'interaction',
      alwaysActive: true,
      tools: [askUser],
    },
    {
      id: 'planning-pack',
      name: 'Planning',
      description: 'The plan panel the model drives and the user watches',
      capability: 'planning',
      alwaysActive: true,
      tools: [updatePlan],
    },
    {
      id: 'planning-control-pack',
      name: 'Planning lifecycle controls',
      description: 'Host-admitted Plan Gate and Goal continuation controls',
      capability: 'planning-control',
      tools: [completePlan, recordContinuationItems],
    },
  ]
}

let registered = false
export function ensureInteractionPlanningPacksRegistered(): void {
  if (registered) return
  registered = true
  for (const pack of buildInteractionPlanningPacks()) registerPiExtensionPack(pack)
}
