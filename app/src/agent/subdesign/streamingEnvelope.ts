/**
 * SubDesign streaming artifact envelope — product-owned, inspired by OpenGenerativeUI
 * but no LangGraph / CopilotKit runtime. Renderer declares streaming support.
 */

import type { SubDesignArtifact, SubDesignArtifactKind } from './types.ts'

export type StreamingStatus = 'streaming' | 'complete' | 'error' | 'cancelled'

export type StreamingUpdate = {
  seq: number
  patch?: unknown
  content?: string
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

export function appendStreamingUpdate(env: StreamingEnvelope, text: string): { envelope: StreamingEnvelope; rejected?: string } {
  if (env.status !== 'streaming') return { envelope: env, rejected: `artifact stream 已終止：${env.status}` }
  const nextSeq = env.updates.length ? env.updates[env.updates.length - 1].seq + 1 : 1
  // Enforce ordered updates; duplicate seq rejected
  if (env.updates.some((u) => u.seq === nextSeq)) return { envelope: env, rejected: 'duplicate seq' }
  const next: StreamingEnvelope = { ...env, updates: [...env.updates, { seq: nextSeq, content: text.slice(0, 64 * 1024) }] }
  return { envelope: next }
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
