import { create } from 'zustand'
import { clampScore, normalizeEvidence, normalizeFindings } from '../agent/subdesign/critique.ts'
import type {
  SubDesignCritique,
  SubDesignCritiquePanelist,
  SubDesignCritiquePanelistId,
  SubDesignCritiqueRound,
  SubDesignCritiqueSession,
  SubDesignCritiqueSessionEvent,
} from '../agent/subdesign/types.ts'

const STORAGE_KEY = 'subagents.subdesign.critique-sessions.v1'

const PANELISTS: ReadonlyArray<Pick<SubDesignCritiquePanelist, 'id' | 'label' | 'focus'>> = [
  { id: 'visual', label: '視覺與品牌', focus: 'Brief coverage · brand conformance' },
  { id: 'accessibility', label: '可及性審查', focus: 'Accessibility · evidence integrity' },
  { id: 'implementation', label: '實作就緒', focus: 'Readiness · artifact boundary' },
]

export const CRITIQUE_PANELIST_IDS: ReadonlyArray<SubDesignCritiquePanelistId> = PANELISTS.map((panelist) => panelist.id)

export function isCritiqueRoundComplete(round: SubDesignCritiqueRound | undefined): boolean {
  return Boolean(round && round.panelists.length === CRITIQUE_PANELIST_IDS.length && round.panelists.every((panelist) => panelist.status === 'complete'))
}

export function isCritiqueSessionReadyForFinal(session: SubDesignCritiqueSession | null, artifactId?: string): boolean {
  return Boolean(
    session &&
    session.status === 'running' &&
    (!artifactId || session.artifactId === artifactId) &&
    isCritiqueRoundComplete(session.rounds[0]) &&
    isCritiqueRoundComplete(session.rounds[1]) &&
    !session.finalCritiqueClaimed,
  )
}

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

function makePanelists(): SubDesignCritiquePanelist[] {
  return PANELISTS.map((panelist) => ({ ...panelist, status: 'pending' }))
}

function makeRounds(): SubDesignCritiqueRound[] {
  return [
    { id: 'round_1', label: '第一輪 · 獨立審查', status: 'pending', panelists: makePanelists() },
    { id: 'round_2', label: '第二輪 · 交叉核對', status: 'pending', panelists: makePanelists() },
  ]
}

function roundCompositeScore(round: SubDesignCritiqueRound): number | undefined {
  const scored = round.panelists.filter((panelist) => panelist.score != null)
  if (!scored.length) return undefined
  return Math.round(scored.reduce((total, panelist) => total + (panelist.score || 0), 0) / scored.length)
}

/** Every panelist note is a real, independently-authored tool call — see docs/adr/0002-critique-theater-real-multipass.md. */
export type SubDesignCritiquePanelistNote = {
  round: 1 | 2
  panelistId: SubDesignCritiquePanelistId
  score: unknown
  summary: unknown
  findings?: unknown
  evidence?: unknown
}

interface SubDesignCritiqueSessionStore {
  current: SubDesignCritiqueSession | null
  history: SubDesignCritiqueSession[]
  start: (input: { briefId: string; artifactId: string; artifactRevision: number }) => SubDesignCritiqueSession
  startRound: (round: 1 | 2) => void
  recordPanelistNote: (artifactId: string, note: SubDesignCritiquePanelistNote) => boolean
  canFinalize: (artifactId: string) => boolean
  claimFinalCritique: (artifactId: string) => boolean
  releaseFinalCritique: (artifactId: string) => void
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

  startRound: (round) => {
    const current = get().current
    if (!current || current.status !== 'running') return
    const roundIndex = round - 1
    if (round === 2 && !isCritiqueRoundComplete(current.rounds[0])) return
    if (current.rounds[roundIndex]?.status === 'complete') return
    const rounds = current.rounds.map((item, index) => index === roundIndex ? { ...item, status: 'active' as const, startedAt: new Date().toISOString() } : item)
    set({
      current: {
        ...current,
        rounds,
        currentRoundIndex: roundIndex,
        events: [...current.events, event(`${rounds[roundIndex].label} 開始`, 'status')].slice(-80),
      },
    })
  },

  recordPanelistNote: (artifactId, note) => {
    const current = get().current
    if (!current || current.status !== 'running' || current.artifactId !== artifactId) return false
    const roundIndex = note.round === 2 ? 1 : 0
    const round = current.rounds[roundIndex]
    if (!round || round.status !== 'active') return false
    if (note.round === 2 && !isCritiqueRoundComplete(current.rounds[0])) return false
    if (!CRITIQUE_PANELIST_IDS.includes(note.panelistId)) return false
    if (round.panelists.find((panelist) => panelist.id === note.panelistId)?.status === 'complete') return false
    const score = clampScore(note.score)
    const summary = String(note.summary || '').trim().slice(0, 800)
    if (!summary) return false
    const findings = normalizeFindings(note.findings)
    const evidence = normalizeEvidence(note.evidence)
    const rounds = current.rounds.map((round, index) => {
      if (index !== roundIndex) return round
      const panelists = round.panelists.map((panelist) =>
        panelist.id === note.panelistId ? { ...panelist, status: 'complete' as const, score, summary, findings, evidence } : panelist,
      )
      const allComplete = panelists.every((panelist) => panelist.status === 'complete')
      return {
        ...round,
        status: allComplete ? ('complete' as const) : ('active' as const),
        panelists,
        compositeScore: roundCompositeScore({ ...round, panelists }),
        completedAt: allComplete ? new Date().toISOString() : round.completedAt,
      }
    })
    const label = PANELISTS.find((item) => item.id === note.panelistId)?.label || note.panelistId
    const previewStep = rounds.reduce((total, round) => total + round.panelists.filter((panelist) => panelist.status === 'complete').length, 0)
    set({
      current: {
        ...current,
        rounds,
        previewStep,
        events: [...current.events, event(`${label} · round ${note.round} · score ${score}`, 'panelist', { roundId: rounds[roundIndex].id, panelistId: note.panelistId, score })].slice(-80),
      },
    })
    return true
  },

  canFinalize: (artifactId) => isCritiqueSessionReadyForFinal(get().current, artifactId),

  claimFinalCritique: (artifactId) => {
    const current = get().current
    if (!isCritiqueSessionReadyForFinal(current, artifactId)) return false
    set({
      current: {
        ...current!,
        finalCritiqueClaimed: true,
        events: [...current!.events, event('六個 panelist notes 已完成；final design_critique call 已鎖定', 'status')].slice(-80),
      },
    })
    return true
  },

  releaseFinalCritique: (artifactId) => {
    const current = get().current
    if (!current || current.status !== 'running' || current.artifactId !== artifactId || !current.finalCritiqueClaimed) return
    set({ current: { ...current, finalCritiqueClaimed: false, events: [...current.events, event('final critique validation 失敗；允許重試', 'error')].slice(-80) } })
  },

  finish: (critique) => {
    const current = get().current
    if (!current || current.status !== 'running') return
    if (!critique) {
      get().fail('Agent run 完成，但沒有寫入可驗證的 critique。')
      return
    }
    if (
      current.artifactId !== critique.artifactId ||
      !isCritiqueRoundComplete(current.rounds[0]) ||
      !isCritiqueRoundComplete(current.rounds[1]) ||
      !current.finalCritiqueClaimed
    ) {
      get().fail('Critique Theater 必須完成兩輪、六個獨立 panelist notes，且只能寫入一次 final critique。')
      return
    }
    const compositeScore = Math.round(
      (Number(critique.briefCoverage || 0) +
        Number(critique.brandConformance || 0) +
        Number(critique.accessibility || 0) +
        Number(critique.implementationReadiness || 0)) / 4,
    )
    const finished: SubDesignCritiqueSession = {
      ...current,
      status: 'completed',
      compositeScore,
      scoreHistory: [...current.scoreHistory, compositeScore].slice(-12),
      events: [
        ...current.events,
        event(`Critique ${critique.verdict} · revision ${critique.revision || 1} · composite ${compositeScore}/${current.threshold}`, 'score', { score: compositeScore }),
      ].slice(-80),
      finishedAt: new Date().toISOString(),
    }
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
