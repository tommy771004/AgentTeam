/** Consent-first automation suggestions derived from repeated successful work. */

import type { ArchiveRecord } from '../types'

export type AutomationSuggestion = {
  id: string
  dedupKey: string
  source: 'usage'
  title: string
  objective: string
  reason: string
  occurrenceCount: number
  latestAt: string
  recommended: { kind: 'daily'; dailyAt: string }
}

const USAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function cleanObjective(objective: string): string {
  return objective
    .replace(/^\[background-delegate\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text: string): Set<string> {
  const lower = text.toLowerCase()
  const result = new Set(
    (lower.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []).filter(
      (token) => !['please', '請', '幫我', '執行', '完成'].includes(token),
    ),
  )
  for (const sequence of lower.match(/[一-鿿]{2,}/g) || []) {
    for (let i = 0; i + 2 <= sequence.length; i += 1) {
      result.add(sequence.slice(i, i + 2))
    }
  }
  return result
}

function similarity(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right])
  if (!union.size) return 0
  let overlap = 0
  for (const token of left) if (right.has(token)) overlap += 1
  return overlap / union.size
}

function fingerprint(group: Array<{ tokens: Set<string> }>): string {
  const counts = new Map<string, number>()
  for (const item of group) {
    for (const token of item.tokens) counts.set(token, (counts.get(token) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([token]) => token)
    .join('.')
}

/**
 * Find at least three similar successful objectives in a recent window.
 * The returned dedupKey is deterministic, so dismissing a suggestion remains
 * effective when a fourth similar run is archived later.
 */
export function detectUsageAutomationSuggestions(
  archive: ArchiveRecord[],
  now = Date.now(),
): AutomationSuggestion[] {
  const records = archive
    .filter((record) => record.status === 'success' && cleanObjective(record.objective))
    .map((record) => ({
      record,
      objective: cleanObjective(record.objective),
      tokens: tokens(cleanObjective(record.objective)),
      at: Date.parse(record.timestamp || '') || 0,
    }))
    .filter((item) => !item.at || now - item.at <= USAGE_WINDOW_MS)
    .sort((a, b) => b.at - a.at)

  const groups: typeof records[] = []
  for (const item of records) {
    const group = groups.find((candidate) =>
      candidate.some((other) => similarity(item.tokens, other.tokens) >= 0.45),
    )
    if (group) group.push(item)
    else groups.push([item])
  }

  return groups
    .filter((group) => group.length >= 3)
    .map((group) => {
      const representative = [...group].sort(
        (a, b) => b.objective.length - a.objective.length || b.at - a.at,
      )[0]
      const key = fingerprint(group)
      const dedupKey = `usage:${key || representative.objective.toLowerCase().slice(0, 80)}`
      return {
        id: `automation_${dedupKey.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100)}`,
        dedupKey,
        source: 'usage' as const,
        title: `建議自動化：${representative.objective.slice(0, 44)}`,
        objective: representative.objective.slice(0, 2000),
        reason: `近 30 天內有 ${group.length} 次相似任務成功完成，適合固定成每日排程。`,
        occurrenceCount: group.length,
        latestAt: new Date(Math.max(...group.map((item) => item.at || now))).toISOString(),
        recommended: { kind: 'daily' as const, dailyAt: '08:00' },
      }
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
}

