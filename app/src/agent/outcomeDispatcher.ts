/**
 * Deep module for consuming Loop post-execution state.
 *
 * Callers provide a small run outcome and receive one serializable audit
 * record. Webhook transport is an adapter: tests can inject a fake delivery,
 * Electron uses the main-process bridge, and a browser falls back to fetch.
 */

import type {
  EventTriggerSnapshot,
  NextState,
  PostStateOutcome,
  ScheduleTriggerSnapshot,
} from './types.ts'

export interface WebhookDeliveryRequest {
  target: string
  payload: Record<string, unknown>
}

export interface WebhookDeliveryResult {
  ok: boolean
  status?: number
  error?: string
}

export interface NextStateContext {
  runId: string
  objective: string
  status: string
  loopType: string
  result?: string
  finishedAt?: string | null
  webhookTarget?: string
  scheduleTrigger?: ScheduleTriggerSnapshot
  eventTrigger?: EventTriggerSnapshot
}

export type WebhookDelivery = (
  request: WebhookDeliveryRequest,
) => Promise<WebhookDeliveryResult>

function nowIso(): string {
  return new Date().toISOString()
}

function safeTarget(raw?: string): string {
  const target = (raw || '').trim()
  if (!target) return ''
  try {
    const parsed = new URL(target)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function compact(value: string | undefined | null, max: number): string | undefined {
  const text = (value || '').trim()
  return text ? text.slice(0, max) : undefined
}

/** Build the stable, secret-free payload sent to an outbound webhook. */
export function buildNextStatePayload(context: NextStateContext): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'subagents.next_state',
    runId: context.runId,
    status: context.status,
    loopType: context.loopType,
    objective: compact(context.objective, 2000) || '',
    result: compact(context.result, 6000),
    finishedAt: context.finishedAt || nowIso(),
    scheduleTrigger: context.scheduleTrigger,
    eventTrigger: context.eventTrigger,
  }
}

/**
 * Consume one Next_State. Missing/invalid webhook configuration is a failed
 * outcome, never a silent success. The delivery adapter is deliberately
 * injectable so this interface is the test surface for the whole module.
 */
export async function consumeNextState(
  nextState: NextState,
  context: NextStateContext,
  deliver: WebhookDelivery = deliverWebhook,
): Promise<PostStateOutcome> {
  const attemptedAt = nowIso()
  if (nextState === 'Halt') {
    return { nextState, status: 'halted', attemptedAt }
  }
  if (nextState === 'Await User Input') {
    return { nextState, status: 'awaiting_user', attemptedAt }
  }

  const target = safeTarget(context.webhookTarget)
  if (!target) {
    return {
      nextState,
      status: 'failed',
      attemptedAt,
      error: 'Dispatch Webhook 失敗：未設定有效 webhook target（需 http/https URL）',
    }
  }

  try {
    const result = await deliver({
      target,
      payload: buildNextStatePayload(context),
    })
    if (!result.ok) {
      return {
        nextState,
        status: 'failed',
        attemptedAt,
        target,
        responseStatus: result.status,
        error: result.error || `Webhook delivery 失敗${result.status ? `（HTTP ${result.status}）` : ''}`,
      }
    }
    return {
      nextState,
      status: 'delivered',
      attemptedAt,
      deliveredAt: nowIso(),
      target,
      responseStatus: result.status,
    }
  } catch (error) {
    return {
      nextState,
      status: 'failed',
      attemptedAt,
      target,
      error: `Webhook delivery 例外：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** Electron main-process adapter with a browser/preview fallback. */
export async function deliverWebhook(
  request: WebhookDeliveryRequest,
): Promise<WebhookDeliveryResult> {
  if (typeof window !== 'undefined' && window.subagents?.webhook?.dispatch) {
    return window.subagents.webhook.dispatch(request)
  }
  if (typeof fetch !== 'function') {
    return { ok: false, error: '目前執行環境沒有可用的 webhook transport' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(request.target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload),
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : `Webhook delivery 失敗（HTTP ${response.status}）`,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
