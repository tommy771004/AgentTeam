import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS } from '../agent/llm'
import { useSettingsStore } from '../store/settingsStore'
import { EngineAvailabilityBanner } from './EngineAvailabilityBanner'
import { FirstRunWizard } from './FirstRunWizard'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderBanner() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<><EngineAvailabilityBanner /><LocationProbe /></>} />
        <Route path="/settings" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_LLM_SETTINGS } })
  window.localStorage.clear()
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('EngineAvailabilityBanner', () => {
  it('未設定任何引擎時顯示誠實警示', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: false, apiKey: '', cliProviders: [] },
    })
    renderBanner()
    expect(screen.getByTestId('engine-availability-banner')).toBeInTheDocument()
    expect(screen.getByText('目前沒有可用的執行引擎')).toBeInTheDocument()
  })

  it('CTA 導向設定的語言模型節', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: false, apiKey: '', cliProviders: [] },
    })
    renderBanner()
    await user.click(screen.getByRole('button', { name: '前往設定' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/settings?section=llm')
  })

  it('已有已授權 CLI 或已填金鑰的 LLM 時不顯示', () => {
    const { rerender } = renderBanner()
    expect(screen.getByTestId('engine-availability-banner')).toBeInTheDocument()

    useSettingsStore.setState({
      settings: {
        ...DEFAULT_LLM_SETTINGS,
        enabled: false,
        apiKey: '',
        cliProviders: [
          { id: 'codex', kind: 'codex', name: 'Codex', enabled: true, authorized: true, models: [] },
        ],
      },
    })
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<><EngineAvailabilityBanner /><LocationProbe /></>} />
          <Route path="/settings" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('engine-availability-banner')).not.toBeInTheDocument()

    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: true, apiKey: 'sk-test', cliProviders: [] },
    })
    expect(screen.queryByTestId('engine-availability-banner')).not.toBeInTheDocument()
  })

  it('橫幅可重開（曾跳過的）精靈', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('subagents.firstRunWizard.state.v1', 'skipped')
    useSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, enabled: false, apiKey: '', cliProviders: [] },
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<><EngineAvailabilityBanner /><FirstRunWizard /><LocationProbe /></>} />
          <Route path="/settings" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '開啟設定精靈' }))
    expect(screen.getByTestId('first-run-wizard')).toBeInTheDocument()
  })
})
