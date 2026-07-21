/**
 * Deterministic text sanitization for LLM egress.
 * Protected spans → fixed non-sensitive marker; line mapping preserved via exclusions.
 */

import type { ProviderSecurityProfile } from './policyMerge.ts'
import type { PolicyDetector } from './policySchema.ts'

/** Stable marker — no sensitive content, recognizable to models. */
export const PROTECTED_EXCLUSION_MARKER = '⟦PROTECTED_EXCLUSION⟧'

export type ProtectedExclusion = {
  source: string
  startLine: number
  endLine: number
  detectorId: string
}

export type SanitizeTextResult = {
  text: string
  exclusions: ProtectedExclusion[]
}

function compileDetector(d: PolicyDetector): { id: string; re: RegExp } | null {
  try {
    let source = d.pattern
    let flags = d.flags || 'g'
    // Support (?i) inline flag stored in baseline patterns
    if (source.startsWith('(?i)')) {
      source = source.slice(4)
      if (!flags.includes('i')) flags += 'i'
    }
    if (!flags.includes('g')) flags += 'g'
    return { id: d.id, re: new RegExp(source, flags) }
  } catch {
    return null
  }
}

function lineAtIndex(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

/** Luhn check for card-like digit runs (baseline.credit-card refinement). */
function luhnOk(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (n < 0 || n > 9) return false
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0 && digits.length >= 13
}

export function sanitizeTextWithProfile(
  text: string,
  profile: ProviderSecurityProfile,
  opts: { source: string },
): SanitizeTextResult {
  if (!text) return { text: text || '', exclusions: [] }

  const detectors = profile.detectors
    .map(compileDetector)
    .filter((x): x is { id: string; re: RegExp } => Boolean(x))

  type Hit = { start: number; end: number; detectorId: string }
  const hits: Hit[] = []

  for (const d of detectors) {
    d.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = d.re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      if (end <= start) {
        // zero-length guard
        d.re.lastIndex = start + 1
        continue
      }
      if (d.id === 'baseline.credit-card') {
        const digits = m[0].replace(/\D/g, '')
        if (!luhnOk(digits)) continue
      }
      hits.push({ start, end, detectorId: d.id })
      // Prevent infinite loops on zero-width; advance for overlapping
      if (m[0].length === 0) d.re.lastIndex++
    }
  }

  if (!hits.length) return { text, exclusions: [] }

  // Merge overlapping/adjacent hits
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Hit[] = []
  for (const h of hits) {
    const last = merged[merged.length - 1]
    if (last && h.start <= last.end) {
      last.end = Math.max(last.end, h.end)
      // keep first detector id for evidence simplicity
    } else {
      merged.push({ ...h })
    }
  }

  const exclusions: ProtectedExclusion[] = []
  let out = ''
  let cursor = 0
  for (const h of merged) {
    out += text.slice(cursor, h.start)
    out += PROTECTED_EXCLUSION_MARKER
    exclusions.push({
      source: opts.source,
      startLine: lineAtIndex(text, h.start),
      endLine: lineAtIndex(text, Math.max(h.start, h.end - 1)),
      detectorId: h.detectorId,
    })
    cursor = h.end
  }
  out += text.slice(cursor)

  return { text: out, exclusions }
}

export type ChatMessageLike = {
  role: string
  content: string
}

export function sanitizeChatMessages(
  messages: ChatMessageLike[],
  profile: ProviderSecurityProfile,
): { messages: ChatMessageLike[]; exclusions: ProtectedExclusion[] } {
  const exclusions: ProtectedExclusion[] = []
  const out = messages.map((m, i) => {
    const source =
      m.role === 'system'
        ? 'system'
        : m.role === 'tool'
          ? 'tool_result'
          : m.role === 'assistant'
            ? 'history'
            : 'prompt'
    const r = sanitizeTextWithProfile(String(m.content ?? ''), profile, {
      source: `${source}#${i}`,
    })
    // Normalize source kind for evidence (strip index for assert friendliness)
    for (const e of r.exclusions) {
      exclusions.push({ ...e, source })
    }
    return { role: m.role, content: r.text }
  })
  return { messages: out, exclusions }
}
