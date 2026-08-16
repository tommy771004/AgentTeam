import { create } from 'zustand'
import { readJson, writeJson } from './persist'

const KEY = 'settings.ui.v1'

type SettingsUiState = {
  /** 「顯示進階」是否開啟。per-app 偏好，回訪時維持上次的檢視模式。 */
  showAdvanced: boolean
}

const DEFAULTS: SettingsUiState = { showAdvanced: false }

interface SettingsUiStore extends SettingsUiState {
  setShowAdvanced: (value: boolean) => void
  toggleAdvanced: () => void
}

/**
 * Settings registry restructure（spec 3/6 ticket 01）— 設定頁的檢視偏好。
 *
 * 只影響「畫幾列」。被 basic 檢視收起來的欄位，值一個字都沒動——切換檢視
 * 不會改變任何行為，只改變你看得到多少。
 */
export const useSettingsUiStore = create<SettingsUiStore>((set, get) => ({
  ...DEFAULTS,
  ...readJson<Partial<SettingsUiState>>(KEY, { fallback: {} }),

  setShowAdvanced: (showAdvanced) => {
    set({ showAdvanced })
    writeJson(KEY, { showAdvanced })
  },
  toggleAdvanced: () => get().setShowAdvanced(!get().showAdvanced),
}))
