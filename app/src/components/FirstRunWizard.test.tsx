import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../agent/llm'
import { useSettingsStore } from '../store/settingsStore'
import { FirstRunWizard, reopenFirstRunWizard } from './FirstRunWizard'

const STATE_KEY = 'subagents.firstRunWizard.state.v1'

const noEngine = { enabled: false, apiKey: '', cliProviders: [] }

function renderWizard() {
  return render(
    <MemoryRouter>
      <FirstRunWizard />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  useSettingsStore.setState({ settings: { ...DEFAULT_LLM_SETTINGS, ...noEngine } })
})

afterEach(() => {
  window.localStorage.clear()
  useSettingsStore.setState({ settings: { ...DEFAULT_LLM_SETTINGS } })
})

describe('FirstRunWizard', () => {
  it('全新 profile 且無可用引擎 → 自動出現', () => {
    renderWizard()
    expect(screen.getByTestId('first-run-wizard')).toBeInTheDocument()
    expect(screen.getByText('首次設定 · 選擇執行方式')).toBeInTheDocument()
  })

  it('已完成或已跳過 → 不出現', () => {
    window.localStorage.setItem(STATE_KEY, 'completed')
    const { rerender } = renderWizard()
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()

    window.localStorage.setItem(STATE_KEY, 'skipped')
    rerender(
      <MemoryRouter>
        <FirstRunWizard />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()
  })

  it('已有可用引擎 → 不出現並靜默標記 completed', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: true, apiKey: 'sk-live' },
    })
    renderWizard()
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(STATE_KEY)).toBe('completed')
  })

  it('狀態機：選路徑 → LLM 憑證 → 上一步回路徑', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /內建語言模型/ }))
    expect(screen.getByText('首次設定 · 設定語言模型')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText('首次設定 · 選擇執行方式')).toBeInTheDocument()
  })

  it('LLM 路徑：填金鑰下一步會寫入 store 並進入驗證步驟', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: /內建語言模型/ }))

    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    await user.type(screen.getByLabelText('API 金鑰'), 'sk-wizard')
    await user.click(screen.getByRole('button', { name: '下一步' }))

    expect(screen.getByText('首次設定 · 驗證連線')).toBeInTheDocument()
    expect(useSettingsStore.getState().settings.enabled).toBe(true)
    expect(useSettingsStore.getState().settings.apiKey).toBe('sk-wizard')
  })

  it('驗證步驟：測試通過才能完成；流程完成寫入 completed', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      testConnection: async () => ({ ok: true, message: 'ok' }),
    })
    renderWizard()
    await user.click(screen.getByRole('button', { name: /內建語言模型/ }))
    await user.type(screen.getByLabelText('API 金鑰'), 'sk-ok')
    await user.click(screen.getByRole('button', { name: '下一步' }))

    expect(screen.getByRole('button', { name: '完成' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '測試連線' }))
    expect(screen.getByText(/連線測試通過/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完成' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '完成' }))
    await user.click(screen.getByRole('button', { name: '開始使用' }))
    expect(window.localStorage.getItem(STATE_KEY)).toBe('completed')
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()
  })

  it('跳過：按鈕與 Esc 都寫入 skipped 並關閉', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: '稍後再說' }))
    expect(window.localStorage.getItem(STATE_KEY)).toBe('skipped')
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()

    // Esc 視同跳過
    window.localStorage.removeItem(STATE_KEY)
    renderWizard()
    await user.keyboard('{Escape}')
    expect(window.localStorage.getItem(STATE_KEY)).toBe('skipped')
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()
  })

  it('曾跳過者可由 reopenFirstRunWizard() 重開（橫幅／設定頁入口）', () => {
    window.localStorage.setItem(STATE_KEY, 'skipped')
    renderWizard()
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()

    act(() => {
      reopenFirstRunWizard()
    })
    expect(screen.getByTestId('first-run-wizard')).toBeInTheDocument()
    expect(screen.getByText('首次設定 · 選擇執行方式')).toBeInTheDocument()
    expect(window.localStorage.getItem(STATE_KEY)).toBeNull()
  })
})
