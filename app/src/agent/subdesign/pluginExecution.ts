import type { PluginResolvedSnapshot } from './pluginSnapshot.ts'
import type { PluginInputValues } from './pluginInputs.ts'
import type { ProviderId, ProviderResultKind } from './providers/providerContract.ts'
import type { SubDesignArtifact } from './types.ts'
import type { StreamingEnvelope } from './streamingEnvelope.ts'

/**
 * Immutable execution contract handed from the Task-run admission path to the
 * Pi Host. The renderer may describe a requested stage, but only the Host may
 * validate and execute it.
 */
export type SubDesignPluginExecutionRequest = {
  schemaVersion: 1
  briefId: string
  pluginId: string
  providerId: ProviderId
  stageId: string
  manifest: unknown
  snapshot: PluginResolvedSnapshot
  /**
   * Resolved values for the contract's declared inputs. Pi Host re-resolves
   * them against the manifest, so this can never carry an undeclared field or
   * skip a required one.
   */
  inputs?: PluginInputValues
  timeoutMs?: number
  outputBudgetBytes?: number
  /** Blocked optional context may fall back; failures and cancellation still stop. */
  failurePolicy?: 'continue-on-blocked' | 'stop'
  /** Frozen provider configuration. Unknown input is parsed by the Host adapter. */
  providerConfig?: {
    enabled: boolean
    endpoint?: string
    resolvedVersion?: string
    sourceFingerprint?: string
    artifactId?: string
    goal?: string
    persona?: string
    targetUrl?: string
    binaryPath?: string
    platform?: 'web' | 'ios_simulator' | 'macos_app'
    stepBudget?: number
  }
}

export type SubDesignPluginExecutionProjection = {
  schemaVersion: 1
  runId: string
  briefId: string
  pluginId: string
  providerId: ProviderId
  stageId: string
  state: 'completed' | 'failed' | 'blocked' | 'cancelled'
  providerKind: ProviderResultKind
  failurePolicy: 'continue-on-blocked' | 'stop'
  summary: string
  evidenceLocator?: string
  artifactLocator?: string
  manifestLocator?: string
  artifact?: SubDesignArtifact
  /**
   * Projection of the artifact stream. The manifest above stays canonical for
   * status, renderer and exports; this only carries ordered updates and the
   * terminal streaming status so preview and activity agree (issue 08).
   */
  stream?: StreamingEnvelope
  context?: {
    kind: 'storybook-components'
    summary: string
    providerVersion: string
    capturedAt: string
    components: Array<{ id: string; title: string; docs?: string; controls?: string[] }>
    sourceFingerprint?: string
    truncated?: boolean
  }
  findings?: Array<{
    kind: 'console' | 'network' | 'performance'
    severity: 'info' | 'warning' | 'blocker'
    message: string
    path?: string
    capturedAt: string
    runId: string
    stageId: string
    providerId: 'chrome-devtools'
    artifactId?: string
  }>
  goalResult?: {
    outcome: 'success' | 'failure' | 'blocked'
    goal: string
    persona: string
    artifactId: string
    steps: Array<{ index: number; action: string; observation: string; friction?: string; capturedAt: string }>
    frictionEvents: Array<{ type: string; detail: string; step?: number; capturedAt: string }>
  }
  attachments?: Array<{ kind: 'screenshot' | 'trace' | 'replay'; locator: string; bytes: number }>
  partial?: boolean
  startedAt: string
  finishedAt: string
}

/** Generic Pi Host settlement rule. Optional context may fall back only when blocked. */
export function shouldStopForProviderProjection(projection: SubDesignPluginExecutionProjection): boolean {
  if (projection.state === 'completed') return false
  return !(projection.state === 'blocked' && projection.failurePolicy === 'continue-on-blocked')
}
