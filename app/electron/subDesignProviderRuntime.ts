import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { admitPluginForTaskRun } from '../src/agent/subdesign/pluginAdmission.ts'
import {
  createResolvedSnapshot,
  DENY_BY_DEFAULT,
  isCapabilityGranted,
} from '../src/agent/subdesign/pluginSnapshot.ts'
import type {
  SubDesignPluginExecutionProjection,
  SubDesignPluginExecutionRequest,
} from '../src/agent/subdesign/pluginExecution.ts'
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  rejectModelAttestedEvidence,
  type ProviderEvidence,
  type ProviderExecutionReceipt,
} from '../src/agent/subdesign/providers/providerContract.ts'
import { parseOpenDesignPluginManifest } from '../src/agent/openDesign/pluginContract.ts'
import {
  pluginInputsMessage,
  resolvePluginInputs,
  type PluginInputValues,
} from '../src/agent/subdesign/pluginInputs.ts'
import type { SubDesignArtifact } from '../src/agent/subdesign/types.ts'
import {
  appendStreamingEvent,
  createStreamingEnvelope,
  finalizeEnvelope,
  pluginRunArtifactId,
  type StreamingEnvelope,
  type StreamingEventInput,
  type StreamingUpdate,
} from '../src/agent/subdesign/streamingEnvelope.ts'
import type { ProviderAttachmentPayload } from './subDesignProviderAttachments.ts'
import {
  isSubDesignProviderAvailable,
  resolveSubDesignProviderAdapter,
} from './subDesignProviderAdapters.ts'

export type SubDesignProviderStageEvent = {
  runId: string
  stageId: string
  providerId: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'
  summary: string
  at: string
}

export type SubDesignProviderStreamEvent = {
  runId: string
  stageId: string
  providerId: string
  update: StreamingUpdate
}

type ActiveStage = { controller: AbortController; terminal: boolean; cancelled: boolean }
const activeStages = new Map<string, ActiveStage>()

function cleanId(value: unknown, max = 180): string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:@/-]+$/.test(value)
    ? value.slice(0, max)
    : ''
}

function parseRequest(value: unknown): SubDesignPluginExecutionRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Partial<SubDesignPluginExecutionRequest>
  if (
    input.schemaVersion !== 1
    || !cleanId(input.briefId)
    || !cleanId(input.pluginId)
    || !cleanId(input.stageId)
    || !input.snapshot
    || typeof input.snapshot !== 'object'
  ) return null
  if (!['fake-pipeline', 'storybook', 'chrome-devtools', 'harness', 'mcp-apps'].includes(String(input.providerId))) return null
  return input as SubDesignPluginExecutionRequest
}

function confinedPath(projectRoot: string, locator: string): string {
  if (!isAbsolute(projectRoot)) throw new Error('SubDesign plugin execution requires an absolute project root')
  const target = resolve(projectRoot, locator)
  const rel = relative(resolve(projectRoot), target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Unsafe project-relative locator: ${locator}`)
  return target
}

function terminalState(kind: ProviderExecutionReceipt['kind']): SubDesignPluginExecutionProjection['state'] {
  if (kind === 'success') return 'completed'
  if (kind === 'blocked') return 'blocked'
  if (kind === 'cancelled') return 'cancelled'
  return 'failed'
}

function blockedProjection(
  request: SubDesignPluginExecutionRequest,
  runId: string,
  summary: string,
  startedAt: string,
): SubDesignPluginExecutionProjection {
  return {
    schemaVersion: 1,
    runId,
    briefId: request.briefId,
    pluginId: request.pluginId,
    providerId: request.providerId,
    stageId: request.stageId,
    state: 'blocked',
    providerKind: 'blocked',
    failurePolicy: request.failurePolicy === 'continue-on-blocked' ? 'continue-on-blocked' : 'stop',
    summary,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}

async function validateExecution(
  request: SubDesignPluginExecutionRequest,
  runId: string,
  threadId: string,
  projectRoot: string,
): Promise<{ ok: true; atoms: string[]; inputs: PluginInputValues } | { ok: false; reason: string }> {
  const contract = parseOpenDesignPluginManifest(request.manifest)
  const admission = admitPluginForTaskRun(contract)
  if (!admission.admitted || admission.contract.kind !== 'v1') {
    return { ok: false, reason: admission.admitted ? 'Plugin execution requires a v1 contract.' : admission.reason }
  }
  if (request.snapshot.pluginId !== request.pluginId) return { ok: false, reason: 'Plugin snapshot identity mismatch.' }
  const resolved = await createResolvedSnapshot({
    pluginId: request.pluginId,
    source: request.snapshot.source,
    resolvedVersion: request.snapshot.resolvedVersion,
    resolvedCommit: request.snapshot.resolvedCommit,
    rawManifest: request.manifest,
    projectRoot,
    contract,
  })
  if ('error' in resolved) return { ok: false, reason: resolved.error }
  if (
    resolved.contentHash !== request.snapshot.contentHash
    || resolved.capabilityFingerprint !== request.snapshot.capabilityFingerprint
  ) return { ok: false, reason: 'Plugin content or capabilities changed; approval is stale.' }
  const denied = request.snapshot.requestedCapabilities.filter((capability) =>
    DENY_BY_DEFAULT.has(capability)
    && !isCapabilityGranted(request.snapshot, capability, { runId, threadId }),
  )
  if (denied.length) return { ok: false, reason: `Capability denied: ${denied.join(', ')}` }
  const stage = admission.contract.manifest.pipeline?.stages.find((candidate) => candidate.id === request.stageId)
  if (!stage) return { ok: false, reason: `Pipeline stage not found: ${request.stageId}` }
  // Re-resolve inputs against the manifest the Host itself parsed. A surface
  // that crashed, a skipped form, or a hand-forged request cannot omit a
  // required input or smuggle an undeclared one past this point.
  const inputs = resolvePluginInputs(admission.contract.manifest.inputs, request.inputs)
  if (!inputs.ok) return { ok: false, reason: `Plugin input rejected: ${pluginInputsMessage(inputs)}` }
  return { ok: true, atoms: stage.atoms || [], inputs: inputs.values }
}

async function persistTrustedResult(
  projectRoot: string,
  request: SubDesignPluginExecutionRequest,
  runId: string,
  receipt: ProviderExecutionReceipt,
  evidence: readonly ProviderEvidence[],
  createArtifact: boolean,
  attachments: readonly ProviderAttachmentPayload[] = [],
): Promise<Pick<SubDesignPluginExecutionProjection, 'evidenceLocator' | 'artifactLocator' | 'manifestLocator' | 'artifact' | 'attachments'>> {
  const base = `.subagents/open-design/runs/${runId}/${request.stageId}`
  const evidenceLocator = `${base}/evidence.json`
  const artifactLocator = `${base}/artifact/index.html`
  const manifestLocator = `${base}/artifact/manifest.json`
  const accepted = evidence.map((item) => rejectModelAttestedEvidence(item))
  if (accepted.some((item) => !item.accepted)) throw new Error('Provider returned untrusted evidence.')
  const evidencePath = confinedPath(projectRoot, evidenceLocator)
  await mkdir(resolve(evidencePath, '..'), { recursive: true })
  await writeFile(evidencePath, JSON.stringify({ schemaVersion: 1, receipt, evidence }, null, 2), 'utf8')
  const persistedAttachments = await Promise.all(attachments.slice(0, 4).map(async (attachment) => {
    const basename = attachment.name && /^[a-zA-Z0-9._-]{1,80}$/.test(attachment.name)
      ? attachment.name.replace(/\.(?:png|json)$/i, '')
      : attachment.kind
    const locator = `${base}/attachments/${basename}.${attachment.extension}`
    const target = confinedPath(projectRoot, locator)
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, attachment.content)
    return { kind: attachment.kind, locator, bytes: attachment.content.byteLength }
  }))
  if (!createArtifact) return { evidenceLocator, ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}) }
  const artifactPath = confinedPath(projectRoot, artifactLocator)
  const manifestPath = confinedPath(projectRoot, manifestLocator)
  await Promise.all([
    mkdir(resolve(artifactPath, '..'), { recursive: true }),
  ])
  await writeFile(artifactPath, `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>SubDesign pipeline artifact</title><body><main><h1>${request.pluginId}</h1><p>${receipt.summary}</p></main></body></html>`, 'utf8')
  const createdAt = receipt.finishedAt
  const artifact: SubDesignArtifact = {
    id: pluginRunArtifactId(runId, request.stageId),
    briefId: request.briefId,
    kind: 'html',
    title: `${request.pluginId} · ${request.stageId}`,
    entry: artifactLocator,
    renderer: 'html',
    exports: ['html', 'zip'],
    supportingFiles: [evidenceLocator, manifestLocator],
    status: 'complete',
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  }
  await writeFile(manifestPath, JSON.stringify({
    ...artifact,
    schemaVersion: 1,
    pluginId: request.pluginId,
    runId,
    stageId: request.stageId,
    providerId: request.providerId,
    evidence: evidenceLocator,
  }, null, 2), 'utf8')
  return { evidenceLocator, artifactLocator, manifestLocator, artifact, ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}) }
}

/**
 * Host-owned provider lifecycle. This is the single execution seam used by
 * Pi Host orchestration; callers can observe projections but cannot execute
 * or attest provider output themselves.
 *
 * Streaming contract: every provider run produces a live StreamingEnvelope
 * with typed events (thinking / tool-call / tool-result / text-delta /
 * file-write / error / done) forwarded via onStreamEvent as
 * host/pipeline-stream. Preview and activity read one consistent status.
 */
export async function executeSubDesignProviderStage(input: {
  request: unknown
  runId: string
  threadId: string
  projectRoot: string
  onEvent?: (event: SubDesignProviderStageEvent) => void
  onStreamEvent?: (event: SubDesignProviderStreamEvent) => void
}): Promise<SubDesignPluginExecutionProjection> {
  const request = parseRequest(input.request)
  if (!request) throw new Error('Invalid SubDesign plugin execution request.')
  const startedAt = new Date().toISOString()
  const emit = (state: SubDesignProviderStageEvent['state'], summary: string) => input.onEvent?.({
    runId: input.runId,
    stageId: request.stageId,
    providerId: request.providerId,
    state,
    summary,
    at: new Date().toISOString(),
  })
  emit('queued', `Pipeline stage ${request.stageId} 已排入 Pi Host。`)
  const validation = await validateExecution(request, input.runId, input.threadId, input.projectRoot)
  if (!validation.ok) {
    const result = blockedProjection(request, input.runId, validation.reason, startedAt)
    emit('blocked', result.summary)
    return result
  }
  if (!isSubDesignProviderAvailable(request.providerId)) {
    const result = blockedProjection(request, input.runId, `Provider unavailable: ${request.providerId}`, startedAt)
    emit('blocked', result.summary)
    return result
  }

  const controller = new AbortController()
  const active: ActiveStage = { controller, terminal: false, cancelled: false }
  activeStages.set(input.runId, active)

  // Live streaming envelope — deterministic id so updates before persist can be reconciled.
  let liveEnvelope: StreamingEnvelope = createStreamingEnvelope({
    artifactId: pluginRunArtifactId(input.runId, request.stageId),
    artifactKind: 'html',
    runId: input.runId,
    stageId: request.stageId,
  })

  const emitStream = (event: StreamingEventInput) => {
    if (active.terminal && event.kind !== 'error' && event.kind !== 'blocked' && event.kind !== 'cancelled' && event.kind !== 'done') return
    const result = appendStreamingEvent(liveEnvelope, event)
    if (result.rejected) return
    liveEnvelope = result.envelope
    if (result.update) {
      input.onStreamEvent?.({
        runId: input.runId,
        stageId: request.stageId,
        providerId: request.providerId,
        update: result.update,
      })
    }
  }

  emit('running', `Pi Host 正在執行 ${request.providerId}/${request.stageId}。`)
  emitStream({ kind: 'tool-call', tool: request.providerId, callId: `${input.runId}:${request.stageId}`, text: `開始 ${request.providerId}/${request.stageId}` })
  try {
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
    const adapter = resolveSubDesignProviderAdapter(request.providerId)
    if (!adapter) throw new Error(`Provider adapter unavailable: ${request.providerId}`)
    const outcome = await adapter.execute({
      request,
      runId: input.runId,
      threadId: input.threadId,
      projectRoot: input.projectRoot,
      signal: controller.signal,
      timeoutMs,
      atoms: validation.atoms,
      inputs: validation.inputs,
      onProgress: (summary) => {
        emit('running', summary)
        emitStream({ kind: 'thinking', text: summary })
      },
    })
    const {
      receipt,
      evidence,
      context: providerContext,
      findings: providerFindings,
      attachments: providerAttachments,
      partial: providerPartial = false,
      goalResult: providerGoalResult,
    } = outcome
    if (active.cancelled) {
      emitStream({ kind: 'cancelled', text: '已取消（late result ignored）' })
      liveEnvelope = finalizeEnvelope(liveEnvelope, 'cancelled')
      const cancelled: SubDesignPluginExecutionProjection = {
        ...blockedProjection(request, input.runId, 'Provider result arrived after terminal cancellation and was ignored.', startedAt),
        state: 'cancelled',
        providerKind: 'cancelled',
        stream: liveEnvelope,
      }
      emit('cancelled', cancelled.summary)
      return cancelled
    }
    emitStream({ kind: 'tool-result', tool: request.providerId, callId: `${input.runId}:${request.stageId}`, ok: receipt.kind === 'success', text: receipt.summary })

    let locators: Pick<SubDesignPluginExecutionProjection, 'evidenceLocator' | 'artifactLocator' | 'manifestLocator' | 'artifact' | 'attachments'> = {}
    let stream: StreamingEnvelope | undefined

    if (receipt.kind === 'success') {
      locators = await persistTrustedResult(input.projectRoot, request, input.runId, receipt, evidence, request.providerId === 'fake-pipeline', providerAttachments)
      if (active.cancelled) {
        emitStream({ kind: 'cancelled', text: '已取消（late result ignored）' })
        liveEnvelope = finalizeEnvelope(liveEnvelope, 'cancelled')
        const cancelled: SubDesignPluginExecutionProjection = {
          ...blockedProjection(request, input.runId, 'Provider result arrived after terminal cancellation and was ignored.', startedAt),
          state: 'cancelled',
          providerKind: 'cancelled',
          stream: liveEnvelope,
        }
        emit('cancelled', cancelled.summary)
        return cancelled
      }
      if (locators.evidenceLocator) emitStream({ kind: 'file-write', path: locators.evidenceLocator, text: 'evidence 已寫入' })
      if (locators.manifestLocator) emitStream({ kind: 'file-write', path: locators.manifestLocator, text: 'manifest 已寫入' })
      if (locators.artifactLocator) emitStream({ kind: 'file-write', path: locators.artifactLocator, text: 'artifact 已寫入' })
      for (const att of (locators.attachments || [])) {
        emitStream({ kind: 'file-write', path: att.locator, text: `attachment ${att.kind}` })
      }
      // Terminal content projection — keeps preview and stream consistent
      if (locators.artifact) {
        try {
          const artifactPath = confinedPath(input.projectRoot, locators.artifact.entry)
          const html = await readFile(artifactPath, 'utf8')
          if (active.cancelled) {
            emitStream({ kind: 'cancelled', text: '已取消（late result ignored）' })
            liveEnvelope = finalizeEnvelope(liveEnvelope, 'cancelled')
            const cancelled: SubDesignPluginExecutionProjection = {
              ...blockedProjection(request, input.runId, 'Provider result arrived after terminal cancellation and was ignored.', startedAt),
              state: 'cancelled',
              providerKind: 'cancelled',
              stream: liveEnvelope,
            }
            emit('cancelled', cancelled.summary)
            return cancelled
          }
          emitStream({ kind: 'text-delta', content: html })
        } catch {
          /* artifact read is best-effort for stream; disk copy remains canonical */
        }
      }
      emitStream({ kind: 'done', text: receipt.summary })
      liveEnvelope = finalizeEnvelope(liveEnvelope, 'complete')
      stream = liveEnvelope
    } else {
      const terminalKind = receipt.kind === 'blocked' ? 'blocked' : receipt.kind === 'cancelled' ? 'cancelled' : 'error'
      emitStream({ kind: terminalKind, text: receipt.summary, ok: false })
      liveEnvelope = finalizeEnvelope(liveEnvelope, terminalKind, receipt.summary)
      stream = liveEnvelope
    }
    active.terminal = true

    const result: SubDesignPluginExecutionProjection = {
      schemaVersion: 1,
      runId: input.runId,
      briefId: request.briefId,
      pluginId: request.pluginId,
      providerId: request.providerId,
      stageId: request.stageId,
      state: terminalState(receipt.kind),
      providerKind: receipt.kind,
      failurePolicy: request.failurePolicy === 'continue-on-blocked' ? 'continue-on-blocked' : 'stop',
      summary: receipt.summary,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
      ...locators,
      ...(stream ? { stream } : {}),
      ...(providerContext ? { context: providerContext } : {}),
      ...(providerFindings ? { findings: providerFindings } : {}),
      ...(providerGoalResult ? { goalResult: providerGoalResult } : {}),
      ...(providerPartial ? { partial: true } : {}),
    }
    emit(result.state, result.summary)
    return result
  } catch (error) {
    const summary = error instanceof Error ? error.message : 'Provider stage failed.'
    const isCancelled = controller.signal.aborted
    const terminalKind = isCancelled ? 'cancelled' : 'error'
    emitStream({ kind: terminalKind, text: summary, ok: false })
    liveEnvelope = finalizeEnvelope(liveEnvelope, terminalKind, summary)
    active.terminal = true
    const failed: SubDesignPluginExecutionProjection = {
      schemaVersion: 1,
      runId: input.runId,
      briefId: request.briefId,
      pluginId: request.pluginId,
      providerId: request.providerId,
      stageId: request.stageId,
      state: isCancelled ? 'cancelled' : 'failed',
      providerKind: isCancelled ? 'cancelled' : 'failure',
      failurePolicy: request.failurePolicy === 'continue-on-blocked' ? 'continue-on-blocked' : 'stop',
      summary,
      startedAt,
      finishedAt: new Date().toISOString(),
      stream: liveEnvelope,
    }
    emit(failed.state, failed.summary)
    return failed
  } finally {
    if (activeStages.get(input.runId) === active) activeStages.delete(input.runId)
  }
}

export function cancelSubDesignProviderRun(runId: string): boolean {
  const active = activeStages.get(runId)
  if (!active || active.terminal) return false
  active.cancelled = true
  active.terminal = true
  active.controller.abort()
  return true
}
