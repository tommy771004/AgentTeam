export type PiPolicyDecision = 'allow' | 'sanitize' | 'deny' | 'ask'

export type PiPolicyRequest = {
  channel: 'llm' | 'tool'
  content: string
  mode: 'off' | 'demo' | 'optional' | 'required'
  unattended?: boolean
  protectedTerms?: string[]
}

export type PiPolicyResult = { decision: PiPolicyDecision; content: string; reason?: string; inspected: boolean }

/** One policy seam for Pi model egress and model-triggered actions. */
export function evaluatePiPolicy(request: PiPolicyRequest): PiPolicyResult {
  if (request.mode === 'off') return { decision: 'allow', content: request.content, inspected: false }
  const protectedTerms = request.protectedTerms || []
  const hit = protectedTerms.find((term) => term && request.content.includes(term))
  if (!hit) return { decision: 'allow', content: request.content, inspected: true }
  if (request.unattended) return { decision: 'deny', content: '', reason: 'unattended protected content', inspected: true }
  if (request.mode === 'required') return { decision: 'ask', content: request.content, reason: `protected term: ${hit}`, inspected: true }
  return { decision: 'sanitize', content: request.content.replaceAll(hit, '[REDACTED]'), reason: 'protected content sanitized', inspected: true }
}
