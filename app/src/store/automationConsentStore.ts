import { create } from 'zustand'
import type { SuggestionDecision } from '../agent/automationConsent'
import type { AutomationCreatedInfo } from '../components/AutomationSuggestionCard'
import { readJson, writeJson } from './persist'

const KEY = 'automation.consent.v1'

type Persisted = {
  /** dedupKey → 使用者對這個建議做過的決定 */
  decisions: Record<string, SuggestionDecision>
  /** dedupKey → 已經建立出來的自動化（重新開 app 後卡片仍顯示已啟用） */
  created: Record<string, AutomationCreatedInfo>
}

const EMPTY: Persisted = { decisions: {}, created: {} }

interface AutomationConsentStore extends Persisted {
  hydrated: boolean
  hydrate: () => void
  recordCreated: (dedupKey: string, info: AutomationCreatedInfo) => void
  dismiss: (dedupKey: string) => void
}

/**
 * Automation one-click（spec 5/6 ticket 01）— 建議的「同意記憶」。
 *
 * 只記兩件事：使用者拒絕過什麼（拒絕要有記憶，否則同一句話會被反覆推銷），
 * 以及哪張卡已經建立成功（重開 app 後卡片仍該顯示已啟用，而不是又問一次）。
 *
 * 這裡不存建議本身——建議是從對話文字即時推導出來的。
 */
export const useAutomationConsentStore = create<AutomationConsentStore>((set, get) => ({
  ...EMPTY,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return
    const data = readJson<Partial<Persisted>>(KEY, { fallback: {} })
    set({
      hydrated: true,
      decisions: data.decisions && typeof data.decisions === 'object' ? data.decisions : {},
      created: data.created && typeof data.created === 'object' ? data.created : {},
    })
  },

  recordCreated: (dedupKey, info) => {
    get().hydrate()
    const decisions = {
      ...get().decisions,
      [dedupKey]: { action: 'accepted' as const, at: new Date().toISOString() },
    }
    const created = { ...get().created, [dedupKey]: info }
    set({ decisions, created })
    writeJson(KEY, { decisions, created })
  },

  dismiss: (dedupKey) => {
    get().hydrate()
    const decisions = {
      ...get().decisions,
      [dedupKey]: { action: 'dismissed' as const, at: new Date().toISOString() },
    }
    set({ decisions })
    writeJson(KEY, { decisions, created: get().created })
  },
}))
