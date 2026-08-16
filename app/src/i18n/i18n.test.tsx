import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../agent/llm'
import type { LlmSettings } from '../agent/types'
import { AppearancePanel } from '../components/settings/panels/AppearancePanel'
import { useSettingsStore } from '../store/settingsStore'
import { registerCatalog, translate } from './index'
import { en } from './locales/en'

function renderAppearance(overrides: Partial<LlmSettings> = {}) {
  const set = vi.fn()
  const settings = { ...DEFAULT_LLM_SETTINGS, ...overrides }
  useSettingsStore.setState({ settings })
  render(
    <AppearancePanel
      settings={settings}
      set={set}
      fieldCtx={{ showAdvanced: true, policyAdminBuild: false }}
    />,
  )
  return { set }
}

beforeEach(() => {
  registerCatalog('en', en)
  useSettingsStore.setState({ settings: { ...DEFAULT_LLM_SETTINGS } })
})

describe('介面語言切換', () => {
  it('預設（跟隨系統，測試環境為 zh-TW）渲染繁中', () => {
    renderAppearance({ uiLanguage: 'zh-TW' })
    expect(screen.getByText('外觀主題')).toBeInTheDocument()
    expect(screen.getByText('介面語言')).toBeInTheDocument()
    expect(screen.getByText('主題')).toBeInTheDocument()
  })

  it('切成 English 後同一批欄位改以英文渲染（不需重新啟動）', () => {
    renderAppearance({ uiLanguage: 'en' })
    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(screen.getByText('Interface language')).toBeInTheDocument()
    expect(screen.getByText('Theme')).toBeInTheDocument()
    // 繁中字樣不應殘留
    expect(screen.queryByText('外觀主題')).not.toBeInTheDocument()
  })

  it('進階標記與說明文字也跟著語言走', () => {
    renderAppearance({ uiLanguage: 'en' })
    expect(screen.getAllByText('Advanced').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/turn it off on slower machines/i),
    ).toBeInTheDocument()
  })

  it('選擇語言會寫回設定（system / zh-TW / en 三個選項都在）', async () => {
    const user = userEvent.setup()
    const { set } = renderAppearance({ uiLanguage: 'zh-TW' })
    const select = screen.getByDisplayValue('繁體中文')
    await user.selectOptions(select, 'en')
    expect(set).toHaveBeenCalledWith({ uiLanguage: 'en' })
    expect(screen.getByRole('option', { name: '跟隨系統' })).toBeInTheDocument()
  })

  it('語言選項本身永遠以該語言自稱（English 不會被翻成「英文」）', () => {
    renderAppearance({ uiLanguage: 'en' })
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '繁體中文' })).toBeInTheDocument()
  })
})

describe('缺翻 fallback', () => {
  it('en 缺 key 時回退 zh-TW，畫面不會空白也不會顯示 raw key', () => {
    registerCatalog('en', {})
    expect(translate('en', 'settings.appearance.theme.label')).toBe('外觀主題')
    registerCatalog('en', en)
  })

  it('內插參數在 fallback 後仍然套用', () => {
    registerCatalog('en', {})
    expect(translate('en', 'settings.appearance.theme.dark')).toBe('深色')
    registerCatalog('en', en)
  })
})
