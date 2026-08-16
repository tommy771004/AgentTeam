import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectAutomationSuggestion } from '../agent/automationSuggestion'
import type { EventDraft, ScheduleDraft } from '../agent/composerAutomationDraft'
import type { AutomationCreatedInfo } from '../agent/automationConsent'
import { AutomationSuggestionCard } from './AutomationSuggestionCard'

const scheduleSuggestion = detectAutomationSuggestion('每天早上 08:00 整理 inbox')!
const eventSuggestion = detectAutomationSuggestion('當 webhook 收到 CI 失敗就通知我')!

function renderCard(
  overrides: Partial<Parameters<typeof AutomationSuggestionCard>[0]> = {},
) {
  const onCreateSchedule = vi.fn(
    async (_draft: ScheduleDraft): Promise<AutomationCreatedInfo> => ({
      kind: 'schedule',
      name: '整理 inbox',
      summary: '每天 08:00 執行',
      href: '#/automation',
      nextRunAt: '2026-08-17T00:00:00.000Z',
    }),
  )
  const onCreateEvent = vi.fn(
    async (_draft: EventDraft): Promise<AutomationCreatedInfo> => ({
      kind: 'event',
      name: 'CI 失敗',
      summary: '來源 webhook.http 時觸發',
      href: '#/automation?tab=events',
    }),
  )
  const onDismiss = vi.fn()
  const onRunnerChange = vi.fn()
  render(
    <AutomationSuggestionCard
      suggestion={scheduleSuggestion}
      queueLength={0}
      queueMax={24}
      availableSkills={[]}
      runner="builtin"
      onRunnerChange={onRunnerChange}
      onCreateSchedule={onCreateSchedule}
      onCreateEvent={onCreateEvent}
      onDismiss={onDismiss}
      {...overrides}
    />,
  )
  return { onCreateSchedule, onCreateEvent, onDismiss, onRunnerChange }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('對話內自動化建議卡', () => {
  it('渲染為提案狀態，並預填建議的時間', () => {
    renderCard()
    const card = screen.getByTestId('automation-suggestion-card')
    expect(card).toHaveAttribute('data-state', 'proposed')
    expect(screen.getByLabelText('每天執行時間')).toHaveValue('08:00')
    expect(screen.getByLabelText('自動化目標')).toHaveValue(scheduleSuggestion.objective)
  })

  it('把觸發前提與佇列負載講清楚', () => {
    renderCard({ queueLength: 3 })
    const card = screen.getByTestId('automation-suggestion-card')
    expect(card).toHaveTextContent('排程只在 app 開啟或常駐系統匣時觸發')
    expect(card).toHaveTextContent('目前待跑 3/24')
  })

  it('改時間後建立，草稿帶著改過的值送出', async () => {
    const user = userEvent.setup()
    const { onCreateSchedule } = renderCard()

    await user.clear(screen.getByLabelText('每天執行時間'))
    await user.type(screen.getByLabelText('每天執行時間'), '09:30')
    await user.click(screen.getByRole('button', { name: '建立' }))

    expect(onCreateSchedule).toHaveBeenCalledTimes(1)
    expect(onCreateSchedule.mock.calls[0][0]).toMatchObject({ kind: 'daily', dailyAt: '09:30' })
  })

  it('建立成功後轉為已啟用，附下次觸發時間與管理連結', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: '建立' }))

    const card = screen.getByTestId('automation-suggestion-card')
    expect(card).toHaveAttribute('data-state', 'enabled')
    expect(card).toHaveTextContent('已啟用定時任務「整理 inbox」')
    expect(card).toHaveTextContent('下次觸發')
    expect(screen.getByRole('link', { name: /前往自動化頁管理/ })).toHaveAttribute(
      'href',
      '#/automation',
    )
    expect(screen.queryByRole('button', { name: '建立' })).not.toBeInTheDocument()
  })

  it('已建立過的建議重新掛載仍是已啟用狀態，不會又問一次', () => {
    renderCard({
      created: {
        kind: 'schedule',
        name: '整理 inbox',
        summary: '每天 08:00 執行',
        href: '#/automation',
      },
    })
    expect(screen.getByTestId('automation-suggestion-card')).toHaveAttribute(
      'data-state',
      'enabled',
    )
  })

  it('「不用了」只回報拒絕，不建立任何東西', async () => {
    const user = userEvent.setup()
    const { onDismiss, onCreateSchedule } = renderCard()
    await user.click(screen.getByRole('button', { name: '不用了' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onCreateSchedule).not.toHaveBeenCalled()
  })

  it('目標清空後不能建立（不建立空任務）', async () => {
    const user = userEvent.setup()
    const { onCreateSchedule } = renderCard()
    await user.clear(screen.getByLabelText('自動化目標'))
    const create = screen.getByRole('button', { name: '建立' })
    expect(create).toBeDisabled()
    await user.click(create)
    expect(onCreateSchedule).not.toHaveBeenCalled()
  })

  it('高頻間隔給出警告，但不擋住使用者', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: '每隔' }))
    await user.clear(screen.getByLabelText('間隔分鐘'))
    await user.type(screen.getByLabelText('間隔分鐘'), '5')
    expect(screen.getByTestId('automation-suggestion-card')).toHaveTextContent(
      '低於 10 分鐘的高頻觸發',
    )
    expect(screen.getByRole('button', { name: '建立' })).toBeEnabled()
  })

  it('可以改執行引擎（不是唯讀顯示）', async () => {
    const user = userEvent.setup()
    const { onRunnerChange } = renderCard()
    await user.click(screen.getByRole('button', { name: 'Codex' }))
    expect(onRunnerChange).toHaveBeenCalledWith('codex')
  })

  it('可以附掛 Skills（不是閹割版）', async () => {
    const user = userEvent.setup()
    const { onCreateSchedule } = renderCard({ availableSkills: ['inbox-triage', 'daily-report'] })
    await user.click(screen.getByRole('button', { name: 'inbox-triage' }))
    await user.click(screen.getByRole('button', { name: '建立' }))
    expect(onCreateSchedule.mock.calls[0][0].skillNames).toEqual(['inbox-triage'])
  })

  it('建立失敗時留在提案狀態並說明原因', async () => {
    const user = userEvent.setup()
    const failing = vi.fn(async (_draft: ScheduleDraft): Promise<AutomationCreatedInfo> => {
      throw new Error('磁碟寫入失敗')
    })
    renderCard({ onCreateSchedule: failing })
    await user.click(screen.getByRole('button', { name: '建立' }))
    expect(screen.getByRole('alert')).toHaveTextContent('磁碟寫入失敗')
    expect(screen.getByTestId('automation-suggestion-card')).toHaveAttribute(
      'data-state',
      'proposed',
    )
  })
})

describe('事件建議卡', () => {
  it('渲染事件條件並可改關鍵字後建立', async () => {
    const user = userEvent.setup()
    const { onCreateEvent } = renderCard({ suggestion: eventSuggestion })

    expect(screen.getByRole('button', { name: 'Webhook' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('事件關鍵字'), 'build failed')
    await user.click(screen.getByRole('button', { name: '建立' }))

    expect(onCreateEvent).toHaveBeenCalledTimes(1)
    expect(onCreateEvent.mock.calls[0][0]).toMatchObject({
      source: 'webhook.http',
      keyword: 'build failed',
    })
  })

  it('事件卡不顯示排程專屬的觸發前提', () => {
    renderCard({ suggestion: eventSuggestion })
    expect(screen.getByTestId('automation-suggestion-card')).not.toHaveTextContent(
      '排程只在 app 開啟',
    )
  })
})
