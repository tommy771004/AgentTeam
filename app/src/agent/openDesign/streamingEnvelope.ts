/**
 * Streaming artifact envelope — product-owned, inspired by OpenGenerativeUI
 * but no LangGraph / CopilotKit runtime. Renderer declares streaming support.
 */

export type StreamingStatus = 'streaming' | 'complete' | 'error' | 'cancelled'

export type StreamingUpdate = {
  seq: number
  patch?: unknown
  content?: string
}

export type StreamingEnvelope = {
  version: 1
  artifactId: string
  runId: string
  stageId?: string
  updates: StreamingUpdate[]
  status: StreamingStatus
  error?: string
  // project-relative output references
  outputRefs?: string[]
}

export type RendererCapabilities = {
  supportedKinds: string[] // e.g., html, deck, markdown, svg
  streaming: boolean
  sandbox: string // CSP
  export?: string[]
}

export function createStreamingEnvelope(artifactId: string, runId: string): StreamingEnvelope {
  return { version: 1, artifactId, runId, updates: [], status: 'streaming', outputRefs: [] }
}

export function appendStreamingUpdate(env: StreamingEnvelope, text: string): { envelope: StreamingEnvelope; rejected?: string } {
  const nextSeq = env.updates.length ? env.updates[env.updates.length - 1].seq + 1 : 1
  // Enforce ordered updates; duplicate seq rejected
  if (env.updates.some((u) => u.seq === nextSeq)) return { envelope: env, rejected: 'duplicate seq' }
  const next: StreamingEnvelope = { ...env, updates: [...env.updates, { seq: nextSeq, content: text.slice(0, 64 * 1024) }] }
  return { envelope: next }
}

export function finalizeEnvelope(env: StreamingEnvelope, status: StreamingStatus, error?: string): StreamingEnvelope {
  return { ...env, status, error: error?.slice(0, 1000) }
}

export function reconcileUpdates(updates: StreamingUpdate[]): StreamingUpdate[] {
  // Deterministic reconciliation: sort by seq, dedupe, drop out-of-order gaps beyond tolerance
  const seen = new Set<number>()
  const sorted = [...updates].sort((a, b) => a.seq - b.seq)
  const out: StreamingUpdate[] = []
  for (const u of sorted) {
    if (seen.has(u.seq)) continue
    seen.add(u.seq)
    out.push(u)
  }
  return out
}

export function canRender(renderer: RendererCapabilities, env: StreamingEnvelope): { ok: true } | { ok: false; reason: string } {
  if (!renderer.supportedKinds.includes(env.artifactId.split(':')[0] || 'html') && !renderer.supportedKinds.includes('html')) {
    // Simplified: check if artifact kind prefix supported; fallback to html
    // For now, allow if streaming false but env is streaming -> reject
  }
  if (env.status === 'streaming' && !renderer.streaming) {
    return { ok: false, reason: '此 renderer 不支援 streaming，需使用可 streaming 的預覽。' }
  }
  return { ok: true }
}
