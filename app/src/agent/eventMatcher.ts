/**
 * Deep module for Proactive event matching.
 *
 * The interface is deliberately small: adapters provide a rule and a
 * normalized payload, and receive either a canonical evidence snapshot or
 * null. No objective text is inspected here or by the Proactive engine.
 */

import type {
  EventPredicateEvidence,
  EventTriggerSnapshot,
  ProactiveEvent,
} from './types'

export interface ProactiveEventPayload {
  source: string
  subject?: string
  hasAttachment?: boolean
  body?: string
  keyword?: string
  receivedAt?: string
}

export interface EventMatchResult {
  event: ProactiveEvent
  trigger: EventTriggerSnapshot
}

export type EventTriggerValidation =
  | { ok: true; snapshot: EventTriggerSnapshot }
  | { ok: false; reason: string }

function evidence(
  expected: string | boolean,
  actual: string | boolean,
): EventPredicateEvidence {
  return { expected, actual, matched: true }
}

function normalizeMatchedAt(input?: string): string {
  if (!input) return new Date().toISOString()
  const date = new Date(input)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

/** Strict boolean matcher; fuzzy objective language is intentionally ignored. */
export function matchProactiveEvent(
  event: ProactiveEvent,
  payload: ProactiveEventPayload,
): EventMatchResult | null {
  if (!event.enabled) return null
  const source = payload.source.trim()
  if (!source || event.source !== source) return null

  const predicates: EventMatchResult['trigger']['predicates'] = {
    source: evidence(event.source, source),
  }

  if (event.subjectContains) {
    const actual = payload.subject || ''
    if (!actual.toLowerCase().includes(event.subjectContains.toLowerCase())) return null
    predicates.subjectContains = evidence(event.subjectContains, actual.slice(0, 1000))
  }

  if (event.hasAttachment != null) {
    const actual = Boolean(payload.hasAttachment)
    if (event.hasAttachment !== actual) return null
    predicates.hasAttachment = evidence(event.hasAttachment, actual)
  }

  if (event.keyword) {
    const actual = `${payload.subject || ''} ${payload.body || ''}`.trim()
    if (!actual.toLowerCase().includes(event.keyword.toLowerCase())) return null
    predicates.keyword = evidence(event.keyword, actual.slice(0, 1000))
  }

  const matchedAt = normalizeMatchedAt(payload.receivedAt)
  if (!matchedAt) return null
  return {
    event,
    trigger: {
      source: 'event',
      eventId: event.id,
      eventName: event.name,
      matchedAt,
      predicates,
    },
  }
}

/** Validate the serializable evidence carried into runExternal / the queue. */
export function validateEventTriggerSnapshot(
  input: unknown,
  now = new Date(),
): EventTriggerValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: '缺少 event matcher evidence' }
  }
  const candidate = input as Partial<EventTriggerSnapshot>
  if (candidate.source !== 'event') {
    return { ok: false, reason: 'trigger source 必須是 event' }
  }
  if (typeof candidate.eventId !== 'string' || !candidate.eventId.trim()) {
    return { ok: false, reason: '缺少 Proactive event id' }
  }
  if (typeof candidate.eventName !== 'string' || !candidate.eventName.trim()) {
    return { ok: false, reason: '缺少 Proactive event name' }
  }
  if (typeof candidate.matchedAt !== 'string' || !candidate.matchedAt.trim()) {
    return { ok: false, reason: '缺少 event payload matchedAt' }
  }
  const matchedAt = new Date(candidate.matchedAt)
  if (Number.isNaN(matchedAt.getTime())) {
    return { ok: false, reason: 'event matchedAt 不是有效 ISO 時間' }
  }
  if (matchedAt.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, reason: 'event matchedAt 不可在未來' }
  }

  const predicates = candidate.predicates
  if (!predicates || typeof predicates !== 'object') {
    return { ok: false, reason: '缺少 boolean predicate evidence' }
  }
  const source = predicates.source
  if (
    !source ||
    typeof source !== 'object' ||
    source.matched !== true ||
    typeof source.expected !== 'string' ||
    typeof source.actual !== 'string'
  ) {
    return { ok: false, reason: 'source predicate evidence 無效' }
  }

  const optionalKeys = ['subjectContains', 'hasAttachment', 'keyword'] as const
  for (const key of optionalKeys) {
    const item = predicates[key]
    if (item == null) continue
    if (
      typeof item !== 'object' ||
      item.matched !== true ||
      (typeof item.expected !== 'string' && typeof item.expected !== 'boolean') ||
      (typeof item.actual !== 'string' && typeof item.actual !== 'boolean')
    ) {
      return { ok: false, reason: `${key} predicate evidence 無效` }
    }
  }

  return {
    ok: true,
    snapshot: {
      source: 'event',
      eventId: candidate.eventId.trim(),
      eventName: candidate.eventName.trim(),
      matchedAt: matchedAt.toISOString(),
      predicates: {
        source: {
          expected: source.expected,
          actual: source.actual,
          matched: true,
        },
        ...(predicates.subjectContains
          ? { subjectContains: { ...predicates.subjectContains, matched: true } }
          : {}),
        ...(predicates.hasAttachment
          ? { hasAttachment: { ...predicates.hasAttachment, matched: true } }
          : {}),
        ...(predicates.keyword
          ? { keyword: { ...predicates.keyword, matched: true } }
          : {}),
      },
    },
  }
}
