import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../../agent/llm'
import type { LlmSettings } from '../../agent/types'
import { fieldAnchorId } from '../../settings/fieldRegistry'
import { useSettingsUiStore } from '../../store/settingsUiStore'
import { AppearancePanel } from './panels/AppearancePanel'

function renderPanel(showAdvanced: boolean, overrides: Partial<LlmSettings> = {}) {
  const set = vi.fn()
  render(
    <AppearancePanel
      settings={{ ...DEFAULT_LLM_SETTINGS, ...overrides }}
      set={set}
      fieldCtx={{ showAdvanced, policyAdminBuild: false }}
    />,
  )
  return { set }
}

beforeEach(() => {
  window.localStorage.clear()
  useSettingsUiStore.setState({ showAdvanced: false })
})

describe('外觀節：registry 驅動的分層', () => {
  it('basic 檢視只留基礎欄位，進階欄位不出現', () => {
    renderPanel(false)
    expect(screen.getByText('外觀主題')).toBeInTheDocument()
    expect(screen.getByText('減少動畫')).toBeInTheDocument()
    expect(screen.getByText('介面字級')).toBeInTheDocument()
    expect(screen.queryByText('側欄半透明')).not.toBeInTheDocument()
    expect(screen.queryByText('程式碼字級')).not.toBeInTheDocument()
  })

  it('advanced 檢視是 basic 的超集合，不是另一組欄位', () => {
    renderPanel(true)
    for (const label of ['外觀主題', '減少動畫', '介面字級', '側欄半透明', '程式碼字級']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('進階欄位帶「進階」標記與一句話說明', () => {
    renderPanel(true)
    expect(screen.getAllByText('進階').length).toBeGreaterThan(0)
    expect(screen.getByText(/在低效能機器上關掉可讓捲動更順/)).toBeInTheDocument()
  })

  it('群組在目前檢視下沒有任何欄位時整張卡不畫（不留空殼標題）', () => {
    // 字級群組在 basic 下仍有「介面字級」，所以標題應該在
    renderPanel(false)
    expect(screen.getByText('字級')).toBeInTheDocument()
  })

  it('每個欄位都掛上穩定錨點，供深連結與高亮使用', () => {
    const { container } = render(
      <AppearancePanel
        settings={DEFAULT_LLM_SETTINGS}
        set={vi.fn()}
        fieldCtx={{ showAdvanced: true, policyAdminBuild: false }}
      />,
    )
    expect(container.querySelector(`#${fieldAnchorId('appearance.theme')}`)).not.toBeNull()
    expect(
      container.querySelector(`#${fieldAnchorId('appearance.translucentSidebar')}`),
    ).not.toBeNull()
  })

  it('值的寫入路徑未改變：改主題仍送出同一個 patch', async () => {
    const user = userEvent.setup()
    const { set } = renderPanel(false)
    await user.selectOptions(screen.getByDisplayValue('深色'), 'light')
    expect(set).toHaveBeenCalledWith({ theme: 'light' })
  })

  it('切到 basic 不會改動被隱藏欄位的值', () => {
    const { set } = renderPanel(false, { translucentSidebar: false, codeFontSize: 15 })
    // 只是少畫幾列——沒有任何寫入
    expect(set).not.toHaveBeenCalled()
  })
})

describe('顯示進階偏好', () => {
  it('預設關閉，切換後持久化', () => {
    expect(useSettingsUiStore.getState().showAdvanced).toBe(false)
    useSettingsUiStore.getState().setShowAdvanced(true)
    expect(useSettingsUiStore.getState().showAdvanced).toBe(true)
    expect(window.localStorage.getItem('subagents:settings.ui.v1')).toContain(
      '"showAdvanced":true',
    )
  })
})
