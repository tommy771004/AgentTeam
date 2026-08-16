import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingTour, reopenOnboardingTour } from './OnboardingTour'

const TOUR_KEY = 'subagents.onboardingTour.state.v1'
const WIZARD_KEY = 'subagents.firstRunWizard.state.v1'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

function renderTour() {
  return render(<OnboardingTour />)
}

describe('OnboardingTour', () => {
  it('精靈未落定時不出現；落定後出現第一步', () => {
    renderTour()
    expect(screen.queryByTestId('onboarding-tour')).not.toBeInTheDocument()

    window.localStorage.setItem(WIZARD_KEY, 'skipped')
    act(() => {
      window.dispatchEvent(new CustomEvent('subagents:first-run-wizard:settled'))
    })
    expect(screen.getByTestId('onboarding-tour')).toBeInTheDocument()
    expect(screen.getByText('使用導覽 · 1/4')).toBeInTheDocument()
    expect(screen.getByText('四種 Loop Pattern')).toBeInTheDocument()
  })

  it('已完成或已跳過 → 不出現', () => {
    window.localStorage.setItem(TOUR_KEY, 'completed')
    window.localStorage.setItem(WIZARD_KEY, 'completed')
    const { rerender } = renderTour()
    expect(screen.queryByTestId('onboarding-tour')).not.toBeInTheDocument()

    window.localStorage.setItem(TOUR_KEY, 'skipped')
    rerender(<OnboardingTour />)
    expect(screen.queryByTestId('onboarding-tour')).not.toBeInTheDocument()
  })

  it('四步推進：下一步×3 → 完成 → completed 並關閉', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(WIZARD_KEY, 'completed')
    renderTour()

    for (const title of ['執行引擎', 'Approval Mode 三段', '誠實性優先']) {
      await user.click(screen.getByRole('button', { name: '下一步' }))
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(window.localStorage.getItem(TOUR_KEY)).toBe('completed')
    expect(screen.queryByTestId('onboarding-tour')).not.toBeInTheDocument()
  })

  it('跳過（按鈕與 Esc）→ skipped 並關閉', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(WIZARD_KEY, 'completed')
    renderTour()
    await user.click(screen.getByRole('button', { name: '跳過導覽' }))
    expect(window.localStorage.getItem(TOUR_KEY)).toBe('skipped')
    expect(screen.queryByTestId('onboarding-tour')).not.toBeInTheDocument()

    // Esc 視同跳過（重開後）
    act(() => reopenOnboardingTour())
    expect(screen.getByTestId('onboarding-tour')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(window.localStorage.getItem(TOUR_KEY)).toBe('skipped')
    expect(screen.queryByTestId('onboarding-tour')).not.toBeInTheDocument()
  })

  it('reopenOnboardingTour() 可從設定頁重開（含上一步回退）', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(TOUR_KEY, 'completed')
    window.localStorage.setItem(WIZARD_KEY, 'completed')
    renderTour()
    expect(screen.queryByTestId('onboarding-tour')).not.toBeInTheDocument()

    act(() => reopenOnboardingTour())
    expect(screen.getByText('四種 Loop Pattern')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('執行引擎')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByText('四種 Loop Pattern')).toBeInTheDocument()
  })
})
