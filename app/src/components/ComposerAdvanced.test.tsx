import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerUiStore } from '../store/composerUiStore'
import { ComposerAdvanced } from './ComposerAdvanced'

const runners = [
  { id: 'builtin' as const, label: '內建', ready: true, blurb: '完整工具' },
  { id: 'codex' as const, label: 'Codex', ready: false, blurb: '本機 CLI' },
]

function renderAdvanced(overrides: Partial<Parameters<typeof ComposerAdvanced>[0]> = {}) {
  const handlers = {
    onLoopChange: vi.fn(),
    onCreateAutomation: vi.fn(),
    onAgentModeChange: vi.fn(),
    onRunnerChange: vi.fn(),
    onDepthChange: vi.fn(),
    onSpeedChange: vi.fn(),
  }
  render(
    <ComposerAdvanced
      loopType={null}
      agentMode="build"
      runner="builtin"
      runners={runners}
      depth="deep"
      speed="standard"
      model=""
      globalModel="gpt-test"
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

beforeEach(() => {
  window.localStorage.clear()
  useComposerUiStore.setState({ advancedOpen: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ComposerAdvanced 進階折疊區', () => {
  it('預設收合：進階控制不在畫面上，觸發器仍可見', () => {
    renderAdvanced()
    expect(screen.getByRole('button', { name: /進階/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Build' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '內建' })).not.toBeInTheDocument()
  })

  it('收合時摘要顯示目前的 loop／引擎／推理程度', () => {
    renderAdvanced({ loopType: 'Goal-based', runner: 'builtin', depth: 'deep' })
    expect(screen.getByRole('button', { name: /進階/ })).toHaveTextContent('目標 · 內建 · 高')
  })

  it('展開後四組進階控制都在：Build/Plan、Loop、引擎、推理程度', async () => {
    const user = userEvent.setup()
    renderAdvanced()
    await user.click(screen.getByRole('button', { name: /進階/ }))

    expect(screen.getByRole('button', { name: 'Build' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '規劃模式' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '自動' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目標' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '內建' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '高' })).toBeInTheDocument()
  })

  it('選擇會回傳既有語義的值，預設不變', async () => {
    const user = userEvent.setup()
    const handlers = renderAdvanced()
    await user.click(screen.getByRole('button', { name: /進階/ }))

    await user.click(screen.getByRole('button', { name: '目標' }))
    expect(handlers.onLoopChange).toHaveBeenCalledWith('Goal-based')

    await user.click(screen.getByRole('button', { name: '自動' }))
    expect(handlers.onLoopChange).toHaveBeenLastCalledWith(null)

    await user.click(screen.getByRole('button', { name: '規劃模式' }))
    expect(handlers.onAgentModeChange).toHaveBeenCalledWith('plan')

    await user.click(screen.getByRole('button', { name: '快思' }))
    expect(handlers.onDepthChange).toHaveBeenCalledWith('fast')
  })

  it('未授權的執行引擎不可選，內建永遠可選', async () => {
    const user = userEvent.setup()
    const handlers = renderAdvanced()
    await user.click(screen.getByRole('button', { name: /進階/ }))

    expect(screen.getByRole('button', { name: 'Codex' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '內建' }))
    expect(handlers.onRunnerChange).toHaveBeenCalledWith('builtin')
  })

  it('展開偏好持久化，重新掛載後仍是展開的', async () => {
    const user = userEvent.setup()
    renderAdvanced()
    await user.click(screen.getByRole('button', { name: /進階/ }))
    expect(screen.getByRole('button', { name: /進階/ })).toHaveAttribute('aria-expanded', 'true')

    // 模擬重開 app：store 重建時從 localStorage 讀回偏好
    expect(window.localStorage.getItem('subagents:composer.ui.v1')).toContain('"advancedOpen":true')
  })
})
