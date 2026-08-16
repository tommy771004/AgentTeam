import { create } from 'zustand'
import { readJson, writeJson } from './persist'

const KEY = 'composer.ui.v1'

type ComposerUiState = {
  /** 「進階」折疊區是否展開。per-app 偏好，不隨對話切換重置。 */
  advancedOpen: boolean
}

const DEFAULTS: ComposerUiState = { advancedOpen: false }

interface ComposerUiStore extends ComposerUiState {
  setAdvancedOpen: (open: boolean) => void
  toggleAdvanced: () => void
}

/**
 * Composer new-task flow（ticket 03）— composer 的 UI 偏好。
 *
 * 只存「長相」，不存任何會改變 run 語義的東西：折疊與否不影響預設 loop、
 * 引擎或深度，展開後看到的仍是同一組既有選項與同一組預設值。
 */
export const useComposerUiStore = create<ComposerUiStore>((set, get) => ({
  ...DEFAULTS,
  ...readJson<Partial<ComposerUiState>>(KEY, { fallback: {} }),

  setAdvancedOpen: (advancedOpen) => {
    set({ advancedOpen })
    writeJson(KEY, { advancedOpen })
  },
  toggleAdvanced: () => get().setAdvancedOpen(!get().advancedOpen),
}))
