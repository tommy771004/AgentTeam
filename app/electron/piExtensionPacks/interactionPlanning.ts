import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { getPiLivePlan, setPiLivePlan, type PiPlanStep } from '../piPackBridges.ts'

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

const VALID_STATUS = new Set(['pending', 'in_progress', 'done'])

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
    steps.push({ id: String(candidate.id || `step-${steps.length + 1}`), title: title.slice(0, 400), status })
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
            status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
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
  ]
}

let registered = false
export function ensureInteractionPlanningPacksRegistered(): void {
  if (registered) return
  registered = true
  for (const pack of buildInteractionPlanningPacks()) registerPiExtensionPack(pack)
}
