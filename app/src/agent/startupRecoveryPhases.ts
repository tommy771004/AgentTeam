export const STARTUP_RECOVERY_PHASES = [
  'durable-read',
  'host-reconciliation',
  'cursor-replay',
  'active-reattachment',
  'terminal-finalization',
  'queue-drain',
] as const

export type StartupRecoveryPhase = typeof STARTUP_RECOVERY_PHASES[number]

export function classifyLiveExternalSessions(raw: unknown): {
  runIds: Set<string>
  conversationIds: Set<string>
} {
  const sessions = Array.isArray(raw)
    ? raw.filter((value): value is Record<string, unknown> => Boolean(
        value && typeof value === 'object' && (value as { active?: unknown }).active === true,
      ))
    : []
  const values = (key: 'runId' | 'conversationId') => new Set(
    sessions.map((session) => session[key]).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  )
  return { runIds: values('runId'), conversationIds: values('conversationId') }
}

export function isExternalThreadStillLive(
  thread: { id: string; externalRun?: { runId?: string } },
  live: { runIds: ReadonlySet<string>; conversationIds: ReadonlySet<string> },
): boolean {
  return live.conversationIds.has(thread.id)
    || Boolean(thread.externalRun?.runId && live.runIds.has(thread.externalRun.runId))
}

export function createStartupRecoveryPhaseTracker() {
  const entered: StartupRecoveryPhase[] = []
  let settled = false

  return {
    advance(phase: StartupRecoveryPhase) {
      if (settled) throw new Error('startup recovery is already settled')
      const expected = STARTUP_RECOVERY_PHASES[entered.length]
      if (phase !== expected) {
        throw new Error(`startup recovery expected ${expected || 'completion'}, received ${phase}`)
      }
      entered.push(phase)
    },
    complete() {
      if (entered.length !== STARTUP_RECOVERY_PHASES.length) {
        throw new Error(`incomplete startup recovery: expected ${STARTUP_RECOVERY_PHASES[entered.length]}`)
      }
      settled = true
      return { status: 'complete' as const, phases: [...entered] }
    },
    fail(error: unknown) {
      settled = true
      return {
        status: 'failed' as const,
        phases: [...entered],
        failedPhase: entered.at(-1) || STARTUP_RECOVERY_PHASES[0],
        reason: error instanceof Error ? error.message : String(error),
      }
    },
  }
}
