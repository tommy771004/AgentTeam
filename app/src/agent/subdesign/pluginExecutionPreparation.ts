import type { SubDesignBrief } from './types.ts'
import type { SubDesignPluginExecutionRequest } from './pluginExecution.ts'
import { parseOpenDesignPluginManifest } from '../openDesign/pluginContract.ts'
import { admitPluginForTaskRun } from './pluginAdmission.ts'
import { createResolvedSnapshot } from './pluginSnapshot.ts'
import { findPluginSnapshot } from './pluginSnapshotStore.ts'
import { resolvePluginTrust, trustStateMessage, type PluginTrustState } from './pluginTrust.ts'

import { loadStorybookProviderState } from './providers/providerSettings.ts'
import type { GrantScope, PluginResolvedSnapshot } from './pluginSnapshot.ts'
import { pluginInputsMessage, resolvePluginInputs } from './pluginInputs.ts'
import type { PluginInput } from '../openDesign/pluginContract.ts'

export type { PluginTrustState }

export type PreparedSubDesignPluginExecution =
  | { ready: true; request: SubDesignPluginExecutionRequest; trust: Extract<PluginTrustState, { state: 'trusted' }> }
  /**
   * `trust` is present whenever the block is a trust decision the user can
   * act on (adopt / refresh / grant). The UI drives those through
   * pluginTrust.ts; preparing a run never resolves them by itself.
   */
  | {
      ready: false
      reason: string
      trust?: PluginTrustState
      /** Present when the block is unfilled inputs: every declared input, so the form can show defaults too. */
      declaredInputs?: PluginInput[]
    }

function manifestPath(sourcePath: string): string | null {
  const normalized = sourcePath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null
  return /open-design\.json$/i.test(normalized) ? normalized : `${normalized}/open-design.json`
}

/** Vendor content resolved to an executable candidate, before any trust decision. */
type PluginCandidate = {
  pluginId: string
  manifestPath: string
  manifest: unknown
  stageId: string
  declaredInputs: PluginInput[]
  candidate: PluginResolvedSnapshot
  stored: PluginResolvedSnapshot | null
}

/**
 * Resolve the immutable vendor content for a brief. Read-only: it fetches the
 * manifest, validates it through the authoritative parser, and builds the
 * candidate snapshot, but writes nothing and decides no trust.
 */
async function resolvePluginCandidate(
  brief: SubDesignBrief,
  projectRoot: string | undefined,
): Promise<PluginCandidate | { reason: string }> {
  if (!projectRoot) return { reason: '尚未綁定專案，略過 plugin pipeline。' }
  const provenance = brief.provenance?.find((item) => item.recordId === brief.templateId)
    || brief.provenance?.[0]
  if (!provenance?.recordId || !provenance.sourcePath) return { reason: '此 brief 沒有可執行的 Open Design provenance。' }
  const path = manifestPath(provenance.sourcePath)
  if (!path) return { reason: 'Plugin manifest path 不合法。' }
  let manifest: unknown
  try {
    const response = await fetch(`/open-design/${path}`, { cache: 'no-cache' })
    if (!response.ok) return { reason: `Plugin manifest HTTP ${response.status}。` }
    manifest = await response.json()
  } catch (error) {
    return { reason: error instanceof Error ? error.message : '無法讀取 plugin manifest。' }
  }
  const contract = parseOpenDesignPluginManifest(manifest)
  const admission = admitPluginForTaskRun(contract)
  if (!admission.admitted || admission.contract.kind !== 'v1') {
    return { reason: admission.admitted ? 'Legacy plugin 僅作為內容來源，不執行 pipeline。' : admission.reason }
  }
  const stage = admission.contract.manifest.pipeline?.stages[0]
  if (!stage) return { reason: 'Plugin 沒有 pipeline stage。' }
  const candidate = await createResolvedSnapshot({
    pluginId: provenance.recordId,
    source: {
      sourcePath: path,
      sourceUrl: provenance.sourceUrl,
      upstreamCommit: provenance.upstreamCommit,
      recordId: provenance.recordId,
    },
    resolvedVersion: admission.contract.manifest.version,
    resolvedCommit: provenance.upstreamCommit,
    rawManifest: manifest,
    projectRoot,
    contract,
  })
  if ('error' in candidate) return { reason: candidate.error }
  return {
    pluginId: provenance.recordId,
    manifestPath: path,
    manifest,
    stageId: stage.id,
    declaredInputs: admission.contract.manifest.inputs ?? [],
    candidate,
    stored: await findPluginSnapshot(provenance.recordId, projectRoot),
  }
}

/**
 * Read-only trust inspection for the UI, with no run in flight. Lets the user
 * see and act on adopt / refresh / grant before starting anything.
 */
export async function inspectSubDesignPluginTrust(
  brief: SubDesignBrief,
  projectRoot: string | undefined,
): Promise<{ trust: PluginTrustState; pluginId: string } | { reason: string }> {
  const resolved = await resolvePluginCandidate(brief, projectRoot)
  if ('reason' in resolved) return resolved
  const scope: GrantScope = { threadId: brief.threadId }
  return {
    pluginId: resolved.pluginId,
    trust: resolvePluginTrust(resolved.stored, resolved.candidate, scope),
  }
}

/**
 * Renderer-side admission only. This resolves immutable vendor content and a
 * persisted grant snapshot, but deliberately does not start a provider. The
 * returned request can only execute after it reaches Pi Host through runTask.
 */
export async function prepareSubDesignPluginExecution(input: {
  brief: SubDesignBrief
  runId: string
  projectRoot?: string
  /** Values collected from the plugin input form (or its native fallback). */
  pluginInputs?: Record<string, unknown>
  providerOverride?: {
    providerId: 'chrome-devtools' | 'harness'
    providerConfig: NonNullable<SubDesignPluginExecutionRequest['providerConfig']>
    failurePolicy: 'continue-on-blocked' | 'stop'
  }
}): Promise<PreparedSubDesignPluginExecution> {
  const resolved = await resolvePluginCandidate(input.brief, input.projectRoot)
  if ('reason' in resolved) return { ready: false, reason: resolved.reason }
  const scope: GrantScope = { runId: input.runId, threadId: input.brief.threadId }
  // Read-only: a vendor update must never overwrite an adopted snapshot as a
  // side effect of preparing a run — the user refreshes explicitly (issue 02).
  const trust = resolvePluginTrust(resolved.stored, resolved.candidate, scope)
  if (trust.state !== 'trusted') {
    return { ready: false, reason: trustStateMessage(trust), trust }
  }
  const snapshot = trust.snapshot
  // A required input is never skipped, whatever happened to the form surface.
  const inputs = resolvePluginInputs(resolved.declaredInputs, input.pluginInputs)
  if (!inputs.ok) {
    return { ready: false, reason: pluginInputsMessage(inputs), declaredInputs: resolved.declaredInputs }
  }
  const { settings: storybook } = await loadStorybookProviderState(input.projectRoot)
  const providerId = input.providerOverride?.providerId || (storybook.enabled ? 'storybook' : 'fake-pipeline')
  const providerConfig = input.providerOverride?.providerConfig || (storybook.enabled ? {
    enabled: true,
    endpoint: storybook.endpoint,
    resolvedVersion: storybook.resolvedVersion,
  } : undefined)
  return {
    ready: true,
    trust,
    request: {
      schemaVersion: 1,
      briefId: input.brief.id,
      pluginId: resolved.pluginId,
      providerId,
      stageId: resolved.stageId,
      manifest: resolved.manifest,
      snapshot,
      ...(Object.keys(inputs.values).length ? { inputs: inputs.values } : {}),
      failurePolicy: input.providerOverride?.failurePolicy || (storybook.enabled ? 'continue-on-blocked' : 'stop'),
      ...(providerConfig ? { providerConfig } : {}),
    },
  }
}

/**
 * The one call shape every SubDesign run start uses: prepare the plugin
 * execution, and hand back the `overrides` fragment for runTask plus whatever
 * trust decision is blocking. Callers spread `overrides` directly so no site
 * repeats the `ready ? { subDesignPluginExecution } : undefined` dance.
 */
export type SubDesignRunPreparation = {
  overrides: { subDesignPluginExecution: SubDesignPluginExecutionRequest } | undefined
  blockedReason?: string
  trust?: PluginTrustState
  declaredInputs?: PluginInput[]
}

export async function prepareSubDesignRun(
  input: Parameters<typeof prepareSubDesignPluginExecution>[0],
): Promise<SubDesignRunPreparation> {
  const prepared = await prepareSubDesignPluginExecution(input)
  if (prepared.ready) {
    return { overrides: { subDesignPluginExecution: prepared.request }, trust: prepared.trust }
  }
  return {
    overrides: undefined,
    blockedReason: prepared.reason,
    trust: prepared.trust,
    declaredInputs: prepared.declaredInputs,
  }
}
