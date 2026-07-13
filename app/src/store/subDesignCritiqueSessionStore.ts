import { create } from 'zustand'
import type {
  SubDesignCritique,
  SubDesignCritiquePanelist,
  SubDesignCritiquePanelistId,
  SubDesignCritiqueRound,
  SubDesignCritiqueSession,
  SubDesignCritiqueSessionEvent,
} from '../agent/subdesign/types'

const STORAGE_KEY = 'subagents.subdesign.critique-sessions.v1'
const SCORE_FIELDS: Record<SubDesignCritiquePanelistId, Array<keyof Pick<SubDesignCritique, 'briefCoverage' | 'brandConformance' | 'accessibility' | 'implementationReadiness'>>> = {
  visual: ['briefCoverage', 'brandConformance'],
  accessibility: ['accessibility', 'briefCoverage'],
  implementation: ['implementationReadiness'],
}

const PANELISTS: ReadonlyArray<Pick<SubDesignCritiquePanelist, 'id' | 'label' | 'focus'>> = [
  { id: 'visual', label: '視覺與品牌', focus: 'Brief coverage · brand conformance' },
  { id: 'accessibility', label: '可及性審查', focus: 'Accessibility · evidence integrity' },
  { id: 'implementation', label: '實作就緒', focus: 'Readiness · artifact boundary' },
]

function readHistory(): SubDesignCritiqueSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(0, 8) : []
  } catch {
    return []
  }
}

function persistHistory(history: SubDesignCritiqueSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 8)))
  } catch {
    /* browser preview may not expose localStorage. */
  }
}

function event(message: string, kind: SubDesignCritiqueSessionEvent['kind'], extra: Partial<SubDesignCritiqueSessionEvent> = {}): SubDesignCritiqueSessionEvent {
  return {
    id: `crit_evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    kind,
    message,
    ...extra,
  }
}

function makePanelists(status: SubDesignCritiquePanelist['status'] = 'pending'): SubDesignCritiquePanelist[] {
  return PANELISTS.map((panelist) => ({ ...panelist, status }))
}

function makeRounds(): SubDesignCritiqueRound[] {
  return [
    {
      id: 'round_1',
      label: '第一輪 · 獨立審查',
      status: 'active',
      panelists: makePanelists('pending'),
      startedAt: new Date().toISOString(),
    },
    {
      id: 'round_2',
      label: '第二輪 · 交叉核對',
      status: 'pending',
      panelists: makePanelists('pending'),
    },
  ]
}

function panelistScore(panelistId: SubDesignCritiquePanelistId, critique: SubDesignCritique, roundIndex: number): number {
  const fields = SCORE_FIELDS[panelistId]
  const score = fields.reduce((total, field) => total + Number(critique[field] || 0), 0) / fields.length
  const roundAdjustment = roundIndex === 0 ? 0 : Math.round((Number(critique.accessibility || 0) - Number(critique.briefCoverage || 0)) / 12)
  return Math.max(0, Math.min(100, Math.round(score + roundAdjustment)))
}

function panelistSummary(panelistId: SubDesignCritiquePanelistId, critique: SubDesignCritique): string {
  const blockerCount = critique.findings.filter((finding) => finding.severity === 'blocker').length
  const warningCount = critique.findings.filter((finding) => finding.severity === 'warning').length
  if (panelistId === 'visual') return `${critique.evidence.some((item) => item.kind === 'screenshot') ? 'Screenshot 已驗證' : '缺少 screenshot'} · ${blockerCount} blocker`
  if (panelistId === 'accessibility') return `${critique.evidence.some((item) => item.kind === 'dom') ? 'DOM evidence 已驗證' : '缺少 DOM evidence'} · ${warningCount} warning`
  return `${critique.evidence.some((item) => item.kind === 'lint') ? 'Lint evidence 已驗證' : '缺少 lint evidence'} · ${critique.verdict}`
}

function completeRounds(session: SubDesignCritiqueSession, critique: SubDesignCritique): SubDesignCritiqueSession {
  const rounds = session.rounds.map((round, roundIndex) => {
    const panelists = round.panelists.map((panelist) => ({
      ...panelist,
      status: 'complete' as const,
      score: panelistScore(panelist.id, critique, roundIndex),
      summary: panelistSummary(panelist.id, critique),
    }))
    const compositeScore = Math.round(panelists.reduce((total, item) => total + (item.score || 0), 0) / panelists.length)
    return {
      ...round,
      status: 'complete' as const,
      panelists,
      compositeScore,
      completedAt: new Date().toISOString(),
    }
  })
  const compositeScore = Math.round(
    (Number(critique.briefCoverage || 0) +
      Number(critique.brandConformance || 0) +
      Number(critique.accessibility || 0) +
      Number(critique.implementationReadiness || 0)) / 4,
  )
  return {
    ...session,
    status: 'completed',
    currentRoundIndex: rounds.length - 1,
    previewStep: rounds.reduce((total, round) => total + round.panelists.length, 0),
    rounds,
    compositeScore,
    scoreHistory: [...session.scoreHistory, compositeScore].slice(-12),
    events: [
      ...session.events,
      event(`Evidence consolidation 完成 · composite ${compositeScore}/${session.threshold}`, 'score', { score: compositeScore }),
      event(`Critique ${critique.verdict} · revision ${critique.revision || 1}`, 'status'),
    ].slice(-80),
    finishedAt: new Date().toISOString(),
  }
}

interface SubDesignCritiqueSessionStore {
  current: SubDesignCritiqueSession | null
  history: SubDesignCritiqueSession[]
  start: (input: { briefId: string; artifactId: string; artifactRevision: number }) => SubDesignCritiqueSession
  advancePreview: (activityLabel?: string) => void
  finish: (critique: SubDesignCritique | null) => void
  interrupt: (reason?: string) => void
  fail: (message: string) => void
  clear: () => void
}

export const useSubDesignCritiqueSessionStore = create<SubDesignCritiqueSessionStore>((set, get) => ({
  current: null,
  history: readHistory(),

  start: (input) => {
    const session: SubDesignCritiqueSession = {
      id: `crit_session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      briefId: input.briefId,
      artifactId: input.artifactId,
      artifactRevision: input.artifactRevision,
      status: 'running',
      threshold: 70,
      currentRoundIndex: 0,
      previewStep: 0,
      rounds: makeRounds(),
      scoreHistory: get().history.flatMap((item) => item.scoreHistory || []).slice(-12),
      events: [event('Critique Theater 啟動 · 2 rounds × 3 panelists', 'status')],
      startedAt: new Date().toISOString(),
    }
    set({ current: session })
    return session
  },

  advancePreview: (activityLabel) => {
    const current = get().current
    if (!current || current.status !== 'running') return
    const allPanelists = current.rounds.reduce((total, round) => total + round.panelists.length, 0)
    const nextStep = Math.min(current.previewStep + 1, allPanelists)
    const rounds = current.rounds.map((round, roundIndex) => {
      const start = roundIndex * PANELISTS.length
      const panelists = round.panelists.map((panelist, panelistIndex) => {
        const step = start + panelistIndex
        return {
          ...panelist,
          status: step < nextStep ? 'complete' as const : step === nextStep ? 'active' as const : 'pending' as const,
        }
      })
      const roundStatus = nextStep >= start + PANELISTS.length
        ? 'complete'
        : nextStep > start
          ? 'active'
          : 'pending'
      return {
        ...round,
        status: roundStatus as SubDesignCritiqueRound['status'],
        panelists,
      }
    })
    const activeRound = rounds.findIndex((round) => round.status === 'active')
    const panelist = activeRound >= 0 ? rounds[activeRound].panelists.find((item) => item.status === 'active') : null
    const nextEvent = panelist
      ? event(activityLabel ? `${panelist.label} · ${activityLabel}` : `${panelist.label} 正在交叉核對`, 'panelist', { roundId: rounds[activeRound].id, panelistId: panelist.id })
      : event('等待 evidence consolidation…', 'status')
    set({ current: { ...current, rounds, currentRoundIndex: Math.max(0, activeRound), previewStep: nextStep, events: [...current.events, nextEvent].slice(-80) } })
  },

  finish: (critique) => {
    const current = get().current
    if (!current || current.status !== 'running') return
    if (!critique) {
      get().fail('Agent run 完成，但沒有寫入可驗證的 critique。')
      return
    }
    const finished = completeRounds(current, critique)
    const history = [finished, ...get().history].slice(0, 8)
    persistHistory(history)
    set({ current: finished, history })
  },

  interrupt: (reason = '使用者中止 critique') => {
    const current = get().current
    if (!current || current.status !== 'running') return
    const rounds = current.rounds.map((round) => ({
      ...round,
      status: round.status === 'complete' ? round.status : 'interrupted' as const,
      panelists: round.panelists.map((panelist) => panelist.status === 'complete' ? panelist : { ...panelist, status: 'interrupted' as const }),
    }))
    const interrupted = { ...current, status: 'interrupted' as const, rounds, events: [...current.events, event(reason, 'status')].slice(-80), interruptReason: reason, finishedAt: new Date().toISOString() }
    const history = [interrupted, ...get().history].slice(0, 8)
    persistHistory(history)
    set({ current: interrupted, history })
  },

  fail: (message) => {
    const current = get().current
    if (!current || current.status !== 'running') return
    const failed = { ...current, status: 'failed' as const, events: [...current.events, event(message, 'error')].slice(-80), finishedAt: new Date().toISOString() }
    const history = [failed, ...get().history].slice(0, 8)
    persistHistory(history)
    set({ current: failed, history })
  },

  clear: () => set({ current: null }),
}))
