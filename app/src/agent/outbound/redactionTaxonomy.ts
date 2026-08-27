/** Stable, metadata-only redaction vocabulary for evidence and UI. */
export const REDACTION_CATEGORIES = [
  'credential',
  'personal-data',
  'financial',
  'filesystem',
  'company-policy',
  'classifier',
  'other',
] as const

export type RedactionCategory = (typeof REDACTION_CATEGORIES)[number]
export type RedactionSummaryEntry = { category: RedactionCategory; count: number }

const BASELINE_CATEGORY: Record<string, RedactionCategory> = {
  'baseline.api-key': 'credential',
  'baseline.private-key': 'credential',
  'baseline.password-field': 'credential',
  'baseline.connection-string': 'credential',
  'baseline.aws-key': 'credential',
  'baseline.tw-national-id': 'personal-data',
  'baseline.email': 'personal-data',
  'baseline.phone-tw': 'personal-data',
  'baseline.credit-card': 'financial',
  'baseline.sensitive-path': 'filesystem',
}

export function classifyRedaction(
  detectorId: string | undefined,
  opts?: { profileSource?: 'company' | 'baseline' | 'none' },
): RedactionCategory {
  const id = String(detectorId || '').trim()
  if (!id) return 'classifier'
  if (BASELINE_CATEGORY[id]) return BASELINE_CATEGORY[id]
  if (/classifier/i.test(id)) return 'classifier'
  if (opts?.profileSource === 'company' || /^company[.:_-]/i.test(id)) return 'company-policy'
  return 'other'
}

export function summarizeRedactions(
  exclusions: ReadonlyArray<{ detectorId?: string }>,
  opts?: { profileSource?: 'company' | 'baseline' | 'none' },
): RedactionSummaryEntry[] {
  const counts = new Map<RedactionCategory, number>()
  for (const exclusion of exclusions) {
    const category = classifyRedaction(exclusion.detectorId, opts)
    counts.set(category, (counts.get(category) || 0) + 1)
  }
  return REDACTION_CATEGORIES
    .filter((category) => counts.has(category))
    .map((category) => ({ category, count: counts.get(category) || 0 }))
}

export function mergeRedactionSummaries(
  summaries: ReadonlyArray<ReadonlyArray<RedactionSummaryEntry> | undefined>,
): RedactionSummaryEntry[] {
  const counts = new Map<RedactionCategory, number>()
  for (const summary of summaries) {
    for (const entry of summary || []) {
      if (!REDACTION_CATEGORIES.includes(entry.category)) continue
      const count = Math.max(0, Math.min(1000, Math.floor(Number(entry.count) || 0)))
      if (count) counts.set(entry.category, (counts.get(entry.category) || 0) + count)
    }
  }
  return REDACTION_CATEGORIES
    .filter((category) => counts.has(category))
    .map((category) => ({ category, count: counts.get(category) || 0 }))
}
