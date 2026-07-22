export type PiTrigger =
  | { kind: 'interactive'; prompt: string }
  | { kind: 'time'; scheduleId: string; claim: string; prompt: string }
  | { kind: 'proactive'; eventId: string; matcher: string; prompt: string }

export function validatePiTrigger(trigger: PiTrigger): PiTrigger {
  if (trigger.kind === 'interactive') return trigger
  if (trigger.kind === 'time' && trigger.scheduleId && trigger.claim) return trigger
  if (trigger.kind === 'proactive' && trigger.eventId && trigger.matcher) return trigger
  throw new Error('automation trigger evidence is required')
}
