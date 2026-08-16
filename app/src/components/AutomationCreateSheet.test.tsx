import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventDraft, ScheduleDraft } from '../agent/composerAutomationDraft'
import { AutomationCreateSheet, type AutomationCreateKind } from './AutomationCreateSheet'

function renderSheet(kind: AutomationCreateKind | null, objective: string) {
  const onCreateSchedule = vi.fn(async (_draft: ScheduleDraft) => {})
  const onCreateEvent = vi.fn(async (_draft: EventDraft) => {})
  const onCreated = vi.fn()
  const onClose = vi.fn()
  render(
    <AutomationCreateSheet
      kind={kind}
      objective={objective}
      onCreateSchedule={onCreateSchedule}
      onCreateEvent={onCreateEvent}
      onCreated={onCreated}
      onClose={onClose}
    />,
  )
  return { onCreateSchedule, onCreateEvent, onCreated, onClose }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AutomationCreateSheet — 排程', () => {
  it('kind=null 時不渲染', () => {
    renderSheet(null, '每天 08:00 整理收件匣')
    expect(screen.queryByTestId('automation-create-sheet')).not.toBeInTheDocument()
  })

  it('以 composer 文字預填目標，並讀出每日與時間', () => {
    renderSheet('schedule', '每天 08:00 整理收件匣')
    expect(screen.getByLabelText(/目標/)).toHaveValue('每天 08:00 整理收件匣')
    expect(screen.getByLabelText(/時間/)).toHaveValue('08:00')
    expect(screen.getByTestId('automation-create-sheet')).toHaveTextContent('每天 08:00 執行')
  })

  it('建立會送出草稿，並回報建立結果與觸發時機', async () => {
    const user = userEvent.setup()
    const { onCreateSchedule, onCreated, onClose } = renderSheet('schedule', '每天 08:00 整理收件匣')

    await user.click(screen.getByRole('button', { name: '建立' }))

    expect(onCreateSchedule).toHaveBeenCalledTimes(1)
    expect(onCreateSchedule.mock.calls[0][0]).toMatchObject({
      kind: 'daily',
      dailyAt: '08:00',
      objective: '每天 08:00 整理收件匣',
    })
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'schedule', summary: '每天 08:00 執行' }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('目標為空時不能建立，只給提示', async () => {
    const user = userEvent.setup()
    const { onCreateSchedule } = renderSheet('schedule', '   ')
    const create = screen.getByRole('button', { name: '建立' })
    expect(create).toBeDisabled()
    expect(screen.getByTestId('automation-create-sheet')).toHaveTextContent('請先填寫目標')
    await user.click(create)
    expect(onCreateSchedule).not.toHaveBeenCalled()
  })

  it('取消不建立任何東西', async () => {
    const user = userEvent.setup()
    const { onCreateSchedule, onCreated, onClose } = renderSheet('schedule', '整理收件匣')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreateSchedule).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('Esc 等同取消', async () => {
    const user = userEvent.setup()
    const { onClose, onCreateSchedule } = renderSheet('schedule', '整理收件匣')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreateSchedule).not.toHaveBeenCalled()
  })

  it('建立失敗時留在表單並說明原因，不假裝成功', async () => {
    const user = userEvent.setup()
    const onCreateSchedule = vi.fn(async (_draft: ScheduleDraft) => {
      throw new Error('磁碟寫入失敗')
    })
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(
      <AutomationCreateSheet
        kind="schedule"
        objective="整理收件匣"
        onCreateSchedule={onCreateSchedule}
        onCreateEvent={vi.fn(async (_draft: EventDraft) => {})}
        onCreated={onCreated}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByRole('button', { name: '建立' }))
    expect(screen.getByRole('alert')).toHaveTextContent('磁碟寫入失敗')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('AutomationCreateSheet — 事件', () => {
  it('預填目標並給真實存在的來源建議', () => {
    renderSheet('event', '收到 webhook 時把內容存檔')
    expect(screen.getByLabelText(/目標/)).toHaveValue('收到 webhook 時把內容存檔')
    expect(screen.getByLabelText(/來源/)).toHaveValue('webhook.http')
    expect(screen.getByRole('button', { name: 'Monitor' })).toBeInTheDocument()
  })

  it('改條件後建立，草稿帶上全部斷言', async () => {
    const user = userEvent.setup()
    const { onCreateEvent, onCreated } = renderSheet('event', '歸檔發票')

    await user.type(screen.getByLabelText(/主旨包含/), 'Invoice')
    await user.click(screen.getByLabelText('必須帶附件'))
    await user.click(screen.getByRole('button', { name: 'Monitor' }))
    await user.click(screen.getByRole('button', { name: '建立' }))

    expect(onCreateEvent).toHaveBeenCalledTimes(1)
    expect(onCreateEvent.mock.calls[0][0]).toMatchObject({
      objective: '歸檔發票',
      source: 'monitor',
      subjectContains: 'Invoice',
      hasAttachment: true,
    })
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ kind: 'event' }))
  })

  it('取消不建立事件規則', async () => {
    const user = userEvent.setup()
    const { onCreateEvent } = renderSheet('event', '歸檔發票')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onCreateEvent).not.toHaveBeenCalled()
  })
})
