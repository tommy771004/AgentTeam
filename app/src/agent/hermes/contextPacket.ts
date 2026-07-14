/**
 * ContextPacket — fixed-slot, priority-aware prompt budget (Phase 4 / R4).
 *
 * Replaces the old "concatenate then slice(0, 2000)" path so session recall,
 * failure lessons, and recent chat are truncated per-slot with inspectable
 * includedChars diagnostics.
 */

export type ContextSlotId =
  | 'projectGuidance'
  | 'objective'
  | 'failureLessons'
  | 'recentChat'
  | 'sessionRecall'
  | 'stepEvidence'
  | 'memory'
  | 'skillsContext'
  | 'pluginFragments'
  | 'extraSystem'

export type ContextSlotSpec = {
  id: ContextSlotId
  /** Higher priority is retained first when the global budget is exhausted. */
  priority: number
  /** Soft per-slot cap before global rebalancing. */
  budgetChars: number
  heading: string
}

/** Default slot order / budgets. Priority is independent of array order. */
export const CONTEXT_SLOT_SPECS: readonly ContextSlotSpec[] = [
  { id: 'projectGuidance', priority: 100, budgetChars: 8_000, heading: '## 專案指引（AGENTS / CLAUDE）' },
  { id: 'objective', priority: 95, budgetChars: 1_200, heading: '## 當前目標' },
  { id: 'failureLessons', priority: 90, budgetChars: 1_200, heading: '## 失敗教訓（同類 — 必須避開）' },
  { id: 'recentChat', priority: 80, budgetChars: 4_800, heading: '## 近期對話' },
  { id: 'sessionRecall', priority: 70, budgetChars: 1_200, heading: '## 跨 session 召回' },
  { id: 'stepEvidence', priority: 65, budgetChars: 4_000, heading: '## 步驟證據' },
  { id: 'memory', priority: 60, budgetChars: 3_000, heading: '## 持久記憶' },
  { id: 'skillsContext', priority: 50, budgetChars: 3_000, heading: '## 技能／掛載內容' },
  { id: 'pluginFragments', priority: 40, budgetChars: 1_500, heading: '## 外掛片段' },
  { id: 'extraSystem', priority: 30, budgetChars: 2_000, heading: '## 額外系統上下文' },
] as const

/** Global cap for the assembled variable packet (excluding stable identity). */
export const CONTEXT_PACKET_TOTAL_BUDGET = 14_000

export type ContextPacketSource = {
  objective?: string
  projectGuidance?: string
  recentChat?: string
  sessionRecall?: string
  stepEvidence?: string
  failureLessons?: string
  memory?: string
  skillsContext?: string
  pluginFragments?: string
  extraSystem?: string
  temporary?: boolean
  /**
   * When true / temporary, session recall content is dropped even if provided.
   */
  skipSessionRecall?: boolean
  skipMemory?: boolean
  sessionRecallSkipReason?: string
  memorySkipReason?: string
}

export type SlotDiagnostic = {
  id: ContextSlotId
  priority: number
  budgetChars: number
  requestedChars: number
  includedChars: number
  droppedReason?: string
}

export type ContextPacketDiagnostics = {
  totalBudget: number
  totalIncludedChars: number
  slots: SlotDiagnostic[]
  temporary: boolean
  notes: string[]
}

export type ContextPacket = {
  diagnostics: ContextPacketDiagnostics
  /** Assembled multi-slot text for the context / volatile layers. */
  assembled: string
  /** Per-slot included body (post-truncation), for tests / tracing. */
  includedBySlot: Partial<Record<ContextSlotId, string>>
}

function clip(text: string, max: number): { text: string; requested: number; included: number; dropped?: string } {
  const raw = (text || '').trim()
  const requested = raw.length
  if (!requested) return { text: '', requested: 0, included: 0 }
  if (requested <= max) return { text: raw, requested, included: requested }
  return {
    text: `${raw.slice(0, Math.max(0, max - 1))}…`,
    requested,
    included: Math.min(requested, max),
    dropped: `slot budget ${max}`,
  }
}

function sourceFor(spec: ContextSlotSpec, src: ContextPacketSource): string {
  switch (spec.id) {
    case 'projectGuidance':
      return src.projectGuidance || ''
    case 'objective':
      return src.objective || ''
    case 'failureLessons':
      return src.failureLessons || ''
    case 'recentChat':
      return src.recentChat || ''
    case 'sessionRecall':
      return src.sessionRecall || ''
    case 'stepEvidence':
      return src.stepEvidence || ''
    case 'memory':
      return src.memory || ''
    case 'skillsContext':
      return src.skillsContext || ''
    case 'pluginFragments':
      return src.pluginFragments || ''
    case 'extraSystem':
      return src.extraSystem || ''
    default:
      return ''
  }
}

/**
 * Build a ContextPacket: each slot is soft-capped, then lower-priority slots
 * are dropped/shrunk until the global budget fits.
 */
export function buildContextPacket(
  source: ContextPacketSource,
  opts?: { totalBudget?: number },
): ContextPacket {
  const totalBudget = opts?.totalBudget ?? CONTEXT_PACKET_TOTAL_BUDGET
  const temporary = source.temporary === true
  const notes: string[] = []

  if (temporary) {
    notes.push('temporary chat: memory read skipped; session recall skipped')
  }
  if (source.skipSessionRecall || temporary) {
    notes.push(
      source.sessionRecallSkipReason ||
        (temporary
          ? 'session recall omitted (temporary chat)'
          : 'session recall omitted'),
    )
  }
  if (source.skipMemory || temporary) {
    notes.push(
      source.memorySkipReason ||
        (temporary ? 'memory omitted (temporary chat)' : 'memory omitted'),
    )
  }

  type Working = {
    spec: ContextSlotSpec
    body: string
    requested: number
    included: number
    droppedReason?: string
  }

  const working: Working[] = CONTEXT_SLOT_SPECS.map((spec) => {
    let raw = sourceFor(spec, source)
    let droppedReason: string | undefined

    if (spec.id === 'sessionRecall' && (source.skipSessionRecall || temporary)) {
      if (raw) droppedReason = source.sessionRecallSkipReason || 'session recall skipped'
      raw = ''
    }
    if (spec.id === 'memory' && (source.skipMemory || temporary)) {
      if (raw) droppedReason = source.memorySkipReason || 'memory skipped'
      raw = ''
    }
    if (spec.id === 'failureLessons' && (source.skipMemory || temporary)) {
      // Failure lessons live in memory store; temporary must not inject them.
      if (raw) droppedReason = source.memorySkipReason || 'failure lessons skipped (temporary/memory off)'
      raw = ''
    }

    const clipped = clip(raw, spec.budgetChars)
    return {
      spec,
      body: clipped.text,
      requested: clipped.requested,
      included: clipped.included,
      droppedReason: droppedReason || clipped.dropped,
    }
  })

  // Global rebalance: drop lowest priority first, then shrink remaining.
  let total = working.reduce((sum, w) => sum + (w.body ? w.included + w.spec.heading.length + 2 : 0), 0)
  const byPriorityAsc = [...working].sort((a, b) => a.spec.priority - b.spec.priority)

  for (const w of byPriorityAsc) {
    if (total <= totalBudget) break
    if (!w.body) continue
    const overhead = w.spec.heading.length + 2
    const cost = w.included + overhead
    total -= cost
    w.droppedReason = w.droppedReason || `global budget ${totalBudget}`
    w.body = ''
    w.included = 0
  }

  // If still over (heading-only leftovers shouldn't happen), hard-shrink high content.
  total = working.reduce((sum, w) => sum + (w.body ? w.included + w.spec.heading.length + 2 : 0), 0)
  if (total > totalBudget) {
    for (const w of byPriorityAsc) {
      if (total <= totalBudget) break
      if (!w.body) continue
      const overhead = w.spec.heading.length + 2
      const allowed = Math.max(0, w.included - (total - totalBudget))
      if (allowed < 40) {
        total -= w.included + overhead
        w.droppedReason = w.droppedReason || `global budget ${totalBudget}`
        w.body = ''
        w.included = 0
      } else {
        const clipped = clip(w.body, allowed)
        total -= w.included - clipped.included
        w.body = clipped.text
        w.included = clipped.included
        w.droppedReason = w.droppedReason || `global shrink to ${allowed}`
      }
    }
  }

  const parts: string[] = []
  const includedBySlot: Partial<Record<ContextSlotId, string>> = {}
  const diagnostics: SlotDiagnostic[] = working.map((w) => {
    if (w.body) {
      const block = `${w.spec.heading}\n${w.body}`
      parts.push(block)
      includedBySlot[w.spec.id] = w.body
    }
    return {
      id: w.spec.id,
      priority: w.spec.priority,
      budgetChars: w.spec.budgetChars,
      requestedChars: w.requested,
      includedChars: w.included,
      droppedReason: w.body ? w.droppedReason : w.droppedReason || (w.requested ? 'dropped' : undefined),
    }
  })

  const assembled = parts.join('\n\n')
  return {
    assembled,
    includedBySlot,
    diagnostics: {
      totalBudget,
      totalIncludedChars: assembled.length,
      slots: diagnostics,
      temporary,
      notes,
    },
  }
}

/** One-line + per-slot summary for engine logs / traces. */
export function formatPacketDiagnostics(packet: ContextPacket): string {
  const d = packet.diagnostics
  const active = d.slots
    .filter((s) => s.includedChars > 0)
    .map((s) => `${s.id}:${s.includedChars}/${s.budgetChars}`)
    .join(' · ')
  const dropped = d.slots
    .filter((s) => s.requestedChars > 0 && s.includedChars === 0)
    .map((s) => `${s.id}(${s.droppedReason || 'drop'})`)
    .join(', ')
  const notes = d.notes.length ? ` · notes: ${d.notes.join('; ')}` : ''
  const dropNote = dropped ? ` · dropped: ${dropped}` : ''
  return `ContextPacket ${d.totalIncludedChars}/${d.totalBudget} chars · ${active || '(empty)'}${dropNote}${notes}`
}

/**
 * Prefer failure-tagged / high-score hits; keep top-k for session recall slot.
 */
export function formatSessionRecallBlock(
  hits: Array<{ source: string; title: string; snippet: string; score: number; tags?: string[] }>,
  opts?: { maxHits?: number; maxChars?: number },
): string {
  const maxHits = opts?.maxHits ?? 3
  const maxChars = opts?.maxChars ?? 1_200
  if (!hits.length) return ''
  const ranked = [...hits].sort((a, b) => {
    const aFail = a.tags?.includes('failure') || /失敗|failure/i.test(a.title + a.snippet) ? 1 : 0
    const bFail = b.tags?.includes('failure') || /失敗|failure/i.test(b.title + b.snippet) ? 1 : 0
    if (bFail !== aFail) return bFail - aFail
    return b.score - a.score
  })
  const lines = [
    '（top-k evidence；失敗教訓優先）',
    ...ranked.slice(0, maxHits).map(
      (h) => `- [${h.source}] ${h.title}: ${h.snippet.slice(0, 160)}`,
    ),
    '若適用請沿用成功做法；若召回為失敗教訓請避開。',
  ]
  return lines.join('\n').slice(0, maxChars)
}
