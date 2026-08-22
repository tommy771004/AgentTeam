/**
 * SubDesign streaming artifact envelope — product-owned, inspired by OpenGenerativeUI
 * but no LangGraph / CopilotKit runtime. Renderer declares streaming support.
 */

import type { SubDesignArtifact, SubDesignArtifactKind } from './types.ts'

export type StreamingStatus = 'streaming' | 'complete' | 'error' | 'blocked' | 'cancelled'

export type StreamingEventKind = 'thinking' | 'tool-call' | 'tool-result' | 'text-delta' | 'file-write' | 'error' | 'blocked' | 'cancelled' | 'done'

export type StreamingUpdate = {
  seq: number
  kind?: StreamingEventKind
  patch?: unknown
  content?: string
  text?: string
  tool?: string
  callId?: string
  path?: string
  ok?: boolean
  at?: string
}

export type StreamingEnvelope = {
  version: 1
  artifactId: string
  /**
   * The artifact's declared kind. Never derived from the id — a real artifact
   * id carries no kind, so parsing one out rejected every genuine artifact.
   */
  artifactKind: SubDesignArtifactKind
  runId: string
  stageId?: string
  updates: StreamingUpdate[]
  status: StreamingStatus
  error?: string
  // project-relative output references
  outputRefs?: string[]
}

export type RendererCapabilities = {
  supportedKinds: SubDesignArtifactKind[]
  streaming: boolean
  sandbox: string // CSP
  export?: string[]
}

export function pluginRunArtifactId(runId: string, stageId: string): string {
  return `plugin_${runId}_${stageId}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export function createStreamingEnvelope(input: {
  artifactId: string
  artifactKind: SubDesignArtifactKind
  runId: string
  stageId?: string
  outputRefs?: string[]
}): StreamingEnvelope {
  return {
    version: 1,
    artifactId: input.artifactId,
    artifactKind: input.artifactKind,
    runId: input.runId,
    stageId: input.stageId,
    updates: [],
    status: 'streaming',
    outputRefs: input.outputRefs ? [...input.outputRefs] : [],
  }
}

/**
 * Build the envelope from the artifact manifest, which stays the source of
 * truth for status, renderer and exports — the stream never becomes a second
 * canonical artifact state (issue 08).
 */
export function envelopeForArtifact(
  artifact: Pick<SubDesignArtifact, 'id' | 'kind' | 'entry'>,
  runId: string,
  stageId?: string,
): StreamingEnvelope {
  return createStreamingEnvelope({
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    runId,
    stageId,
    outputRefs: artifact.entry ? [artifact.entry] : [],
  })
}

export type StreamingEventInput = {
  kind: StreamingEventKind
  content?: string
  text?: string
  tool?: string
  callId?: string
  path?: string
  ok?: boolean
  patch?: unknown
}

export function appendStreamingEvent(
  env: StreamingEnvelope,
  input: StreamingEventInput,
): { envelope: StreamingEnvelope; rejected?: string; update?: StreamingUpdate } {
  if (env.status !== 'streaming') return { envelope: env, rejected: `artifact stream 已終止：${env.status}` }
  const nextSeq = env.updates.length ? env.updates[env.updates.length - 1].seq + 1 : 1
  if (env.updates.some((u) => u.seq === nextSeq)) return { envelope: env, rejected: 'duplicate seq' }
  const at = new Date().toISOString()
  const update: StreamingUpdate = {
    seq: nextSeq,
    kind: input.kind,
    at,
    ...(input.content !== undefined ? { content: input.content.slice(0, 64 * 1024) } : {}),
    ...(input.text !== undefined ? { text: input.text.slice(0, 4 * 1024) } : {}),
    ...(input.tool !== undefined ? { tool: input.tool.slice(0, 120) } : {}),
    ...(input.callId !== undefined ? { callId: input.callId.slice(0, 180) } : {}),
    ...(input.path !== undefined ? { path: input.path.slice(0, 512) } : {}),
    ...(input.ok !== undefined ? { ok: input.ok } : {}),
    ...(input.patch !== undefined ? { patch: input.patch } : {}),
  }
  const next: StreamingEnvelope = { ...env, updates: [...env.updates, update] }
  return { envelope: next, update }
}

export function appendStreamingUpdate(env: StreamingEnvelope, text: string): { envelope: StreamingEnvelope; rejected?: string } {
  const result = appendStreamingEvent(env, { kind: 'text-delta', content: text.slice(0, 64 * 1024) })
  return { envelope: result.envelope, rejected: result.rejected }
}

/**
 * Merge an update projected by Pi Host. Updates may be replayed or arrive out
 * of order; terminal state is derived only from the contiguous prefix.
 */
export function mergeStreamingUpdate(
  env: StreamingEnvelope,
  update: StreamingUpdate,
): { envelope: StreamingEnvelope; rejected?: string } {
  if (!Number.isSafeInteger(update.seq) || update.seq < 1) {
    return { envelope: env, rejected: 'invalid seq' }
  }
  const duplicate = env.updates.find((candidate) => candidate.seq === update.seq)
  if (duplicate) {
    return JSON.stringify(duplicate) === JSON.stringify(update)
      ? { envelope: env }
      : { envelope: env, rejected: 'conflicting duplicate seq' }
  }
  if (env.status !== 'streaming') {
    return { envelope: env, rejected: `artifact stream 已終止：${env.status}` }
  }
  const updates = [...env.updates, update].sort((left, right) => left.seq - right.seq)
  const contiguous = reconcileUpdates(updates)
  const terminal = contiguous.at(-1)
  const status: StreamingStatus = terminal?.kind === 'done'
    ? 'complete'
    : terminal?.kind === 'error'
      ? 'error'
      : terminal?.kind === 'blocked'
        ? 'blocked'
        : terminal?.kind === 'cancelled'
          ? 'cancelled'
          : 'streaming'
  const error = status === 'error' || status === 'blocked' || status === 'cancelled'
    ? terminal?.text?.slice(0, 1000)
    : undefined
  return { envelope: { ...env, updates, status, ...(error ? { error } : {}) } }
}

export function finalizeEnvelope(env: StreamingEnvelope, status: Exclude<StreamingStatus, 'streaming'>, error?: string): StreamingEnvelope {
  if (env.status !== 'streaming') return env
  return { ...env, status, error: error?.slice(0, 1000) }
}

export function reconcileUpdates(updates: StreamingUpdate[]): StreamingUpdate[] {
  // Deterministic reconciliation: sort, dedupe, then keep the contiguous prefix.
  const seen = new Set<number>()
  const sorted = [...updates].sort((a, b) => a.seq - b.seq)
  const out: StreamingUpdate[] = []
  for (const u of sorted) {
    if (!Number.isSafeInteger(u.seq) || u.seq < 1 || seen.has(u.seq)) continue
    if (u.seq !== out.length + 1) break
    seen.add(u.seq)
    out.push(u)
  }
  return out
}

export function canRender(renderer: RendererCapabilities, env: StreamingEnvelope): { ok: true } | { ok: false; reason: string } {
  if (!renderer.supportedKinds.includes(env.artifactKind)) {
    return { ok: false, reason: `此 renderer 不支援 ${env.artifactKind} artifact。` }
  }
  if (env.status === 'streaming' && !renderer.streaming) {
    return { ok: false, reason: '此 renderer 不支援 streaming，需使用可 streaming 的預覽。' }
  }
  return { ok: true }
}
