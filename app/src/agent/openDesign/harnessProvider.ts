/**
 * Harness goal-based UX testing — optional, macOS permission-sensitive.
 * Session is adapter-owned, never Task-run owner. Stop cancels targeted.
 */
import { isProviderEnabled } from './providerFlags.ts'
import type { ProviderAvailability, ProviderEvidence } from './providerContract.ts'

export const HARNESS_PINNED_VERSION = '0.1.0-alpha'

export type HarnessGoalOutcome = 'success' | 'failure' | 'blocked'

export type HarnessStep = {
  index: number
  action: string
  observation: string
  friction?: string
}

export type HarnessResult = {
  outcome: HarnessGoalOutcome
  steps: HarnessStep[]
  frictionEvents: Array<{ type: string; detail: string }>
  screenshotLocators: string[]
  startedAt: string
  finishedAt: string
  runId: string
  stageId: string
}

export function harnessAvailability(opts?: { platform?: string; hasPermission?: boolean }): ProviderAvailability {
  if (!isProviderEnabled('harness')) return { available: false, reason: 'Harness provider 未啟用（feature flag 關閉）', code: 'unavailable' }
  if (opts?.platform && opts.platform !== 'darwin') return { available: false, reason: `Harness 目前僅支援 macOS（platform=${opts.platform}）`, code: 'unsupported-platform' }
  if (opts?.hasPermission === false) return { available: false, reason: '需要 Screen Recording / Accessibility 權限', code: 'permission-denied' }
  return { available: true }
}

export function normalizeHarnessFixture(raw: unknown, runId: string, stageId: string): HarnessResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const outcome = (['success', 'failure', 'blocked'].includes(String(obj.outcome)) ? String(obj.outcome) : 'failure') as HarnessGoalOutcome
  const stepsRaw = Array.isArray(obj.steps) ? obj.steps : []
  const steps: HarnessStep[] = stepsRaw.slice(0, 50).map((s, i) => {
    const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    return { index: i, action: String(r.action || `step ${i}`), observation: String(r.observation || ''), friction: r.friction ? String(r.friction) : undefined }
  })
  const frictionEvents = Array.isArray(obj.frictionEvents) ? obj.frictionEvents.slice(0, 20).map((e) => {
    const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
    return { type: String(r.type || 'friction'), detail: String(r.detail || '') }
  }) : []
  const screenshotLocators = Array.isArray(obj.screenshots) ? obj.screenshots.slice(0, 10).map((s) => String(s).slice(0, 500)).filter(Boolean) : []
  return {
    outcome,
    steps,
    frictionEvents,
    screenshotLocators: screenshotLocators.map((p) => p.startsWith('evidence/') ? p : `evidence/${runId}/${stageId}/${p}`),
    startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : new Date().toISOString(),
    finishedAt: typeof obj.finishedAt === 'string' ? obj.finishedAt : new Date().toISOString(),
    runId,
    stageId,
  }
}

export function harnessToEvidence(result: HarnessResult): ProviderEvidence {
  return {
    evidenceId: `har_${result.runId}_${result.stageId}`,
    runId: result.runId,
    stageId: result.stageId,
    providerId: 'harness' as const,
    kind: 'goal' as const,
    summary: `Harness ${result.outcome}: ${result.steps.length} steps, ${result.frictionEvents.length} frictions`,
    capturedAt: result.finishedAt,
    projectRelativeLocator: result.screenshotLocators[0],
    adapterIssued: true as const,
    severity: result.outcome === 'success' ? 'info' : result.outcome === 'blocked' ? 'warning' : 'blocker',
  }
}
