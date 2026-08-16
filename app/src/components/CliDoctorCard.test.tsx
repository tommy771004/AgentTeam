import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../agent/llm'
import { useSettingsStore } from '../store/settingsStore'
import { CliDoctorCard } from './CliDoctorCard'

// CliDoctorCard 需要 Electron 的 cli.doctor IPC 才會渲染；測試環境注入 stub
beforeAll(() => {
  ;(window as unknown as { subagents: unknown }).subagents = {
    cli: {
      doctor: async () => ({
        readyToRun: false,
        summary: 'stub summary',
        checks: [],
      }),
    },
  }
})

afterEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_LLM_SETTINGS } })
})

function renderCard() {
  return render(
    <MemoryRouter>
      <CliDoctorCard />
    </MemoryRouter>,
  )
}

describe('CliDoctorCard 語言模型檢查磚', () => {
  it('未啟用 → 「未啟用」狀態與「前往設定」補救', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: false, apiKey: '', cliProviders: [] },
    })
    renderCard()
    const tile = screen.getByTestId('llm-check-tile')
    expect(tile).toHaveTextContent('未啟用')
    expect(tile).toHaveTextContent('語言模型未啟用')
    expect(screen.getByRole('link', { name: '前往設定' })).toHaveAttribute('href', '/settings?section=llm')
  })

  it('已啟用未測試 → 「未通連」＋手動「測試連線」通過後轉「可用」', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: true, apiKey: 'sk-test', cliProviders: [] },
    })
    useSettingsStore.setState({
      testConnection: async () => ({ ok: true, message: 'ok' }),
    })
    renderCard()
    expect(screen.getByTestId('llm-check-tile')).toHaveTextContent('未通連')

    await user.click(screen.getByRole('button', { name: '測試連線' }))
    expect(screen.getByTestId('llm-check-tile')).toHaveTextContent('可用')
    expect(screen.queryByRole('button', { name: '測試連線' })).not.toBeInTheDocument()
  })

  it('測試連線失敗 → 停留「未通連」並顯示失敗訊息', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: true, apiKey: 'sk-bad', cliProviders: [] },
    })
    useSettingsStore.setState({
      testConnection: async () => ({ ok: false, message: '401 Unauthorized' }),
    })
    renderCard()
    await user.click(screen.getByRole('button', { name: '測試連線' }))
    const tile = screen.getByTestId('llm-check-tile')
    expect(tile).toHaveTextContent('未通連')
    expect(tile).toHaveTextContent('401 Unauthorized')
  })
})
