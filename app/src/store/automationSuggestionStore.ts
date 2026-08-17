import { create } from 'zustand'
import {
  detectUsageAutomationSuggestions,
  type AutomationSuggestion,
} from '../agent/hermes/automationSuggestions.ts'
import type { ArchiveRecord } from '../agent/types.ts'

const STORAGE_KEY = 'subagents.automationSuggestions.v1'

type Decision = { action: 'accepted' | 'dismissed'; at: string }

interface AutomationSuggestionStore {
  hydrated: boolean
  suggestions: AutomationSuggestion[]
  decisions: Record<string, Decision>
  hydrate: () => void
  refreshFromArchive: (archive: ArchiveRecord[]) => void
  decide: (dedupKey: string, action: Decision['action']) => void
}

function persist(suggestions: AutomationSuggestion[], decisions: Record<string, Decision>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ suggestions, decisions }))
  } catch {
    /* localStorage may be unavailable in a restricted browser */
  }
}

export const useAutomationSuggestionStore = create<AutomationSuggestionStore>((set, get) => ({
  hydrated: false,
  suggestions: [],
  decisions: {},

  hydrate: () => {
    if (get().hydrated) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const data = raw
        ? (JSON.parse(raw) as {
            suggestions?: AutomationSuggestion[]
            decisions?: Record<string, Decision>
          })
        : {}
      set({
        hydrated: true,
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        decisions: data.decisions && typeof data.decisions === 'object' ? data.decisions : {},
      })
    } catch {
      set({ hydrated: true })
    }
  },

  refreshFromArchive: (archive) => {
    get().hydrate()
    const candidates = detectUsageAutomationSuggestions(archive)
    const decisions = get().decisions
    const suggestions = candidates.filter((candidate) => !decisions[candidate.dedupKey])
    set({ suggestions })
    persist(suggestions, decisions)
  },

  decide: (dedupKey, action) => {
    get().hydrate()
    const decisions = {
      ...get().decisions,
      [dedupKey]: { action, at: new Date().toISOString() },
    }
    const suggestions = get().suggestions.filter((item) => item.dedupKey !== dedupKey)
    set({ decisions, suggestions })
    persist(suggestions, decisions)
  },
}))

