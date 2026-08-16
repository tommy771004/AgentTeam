import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRunInput, TaskRunResult } from '../agent/taskRunCoordinator'
import { RetryWithOverrides } from './RetryWithOverrides'

const runTask = vi.fn(async (_input: TaskRunInput) => ({ threadId: 't1' }) as TaskRunResult)

vi.mock('../agent/taskRunCoordinator', () => ({
  runTask: (input: TaskRunInput) => runTask(input),
}))

const defaults = { maxIterations: 5, minConfidence: 0.8 }

function renderRetry(overrides: Partial<Parameters<typeof RetryWithOverrides>[0]> = {}) {
  render(
    <RetryWithOverrides
      threadId="t1"
      objective="比較三家供應商報價"
      loopType="Goal-based"
      evidence={{}}
      defaults={defaults}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  runTask.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('對話內調整參數重跑', () => {
  it('先出現摺疊按鈕，參數面板要點開才在', async () => {
    const user = userEvent.setup()
    renderRetry()
    expect(screen.queryByLabelText('最大迭代次數')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /調整參數重跑/ }))
    expect(screen.getByLabelText('最大迭代次數')).toHaveValue(5)
    expect(screen.getByLabelText('最低信心')).toHaveValue(0.8)
    // 逾時刻意不提供：RuntimeOverrides.timeoutMs 在 run 路徑上沒有消費者
    expect(screen.queryByLabelText(/逾時/)).not.toBeInTheDocument()
  })

  it('改過的參數會進到新 run，且來源記為 retry、回到同一個對話', async () => {
    const user = userEvent.setup()
    renderRetry()
    await user.click(screen.getByRole('button', { name: /調整參數重跑/ }))

    const iterations = screen.getByLabelText('最大迭代次數')
    await user.clear(iterations)
    await user.type(iterations, '9')
    await user.click(screen.getByRole('button', { name: '重跑' }))

    expect(runTask).toHaveBeenCalledTimes(1)
    const input = runTask.mock.calls[0][0]
    expect(input).toMatchObject({
      sourceKind: 'retry',
      objective: '比較三家供應商報價',
      reuseThreadId: 't1',
      loopType: 'Goal-based',
    })
    expect(input.overrides).toEqual({
      maxIterations: 9,
      minConfidence: 0.8,
    })
  })

  it('超出範圍的輸入在送出前被夾緊，不會把 NaN 送進 run', async () => {
    const user = userEvent.setup()
    renderRetry()
    await user.click(screen.getByRole('button', { name: /調整參數重跑/ }))

    const iterations = screen.getByLabelText('最大迭代次數')
    await user.clear(iterations)
    await user.type(iterations, '999')
    await user.click(screen.getByRole('button', { name: '重跑' }))

    expect(runTask.mock.calls[0][0].overrides?.maxIterations).toBe(20)
  })

  it('取消不重跑', async () => {
    const user = userEvent.setup()
    renderRetry()
    await user.click(screen.getByRole('button', { name: /調整參數重跑/ }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(runTask).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('最大迭代次數')).not.toBeInTheDocument()
  })

  it('缺事件證據的 Proactive run 擋下重跑並說明去哪裡跑', async () => {
    const user = userEvent.setup()
    renderRetry({ loopType: 'Proactive', evidence: {} })
    await user.click(screen.getByRole('button', { name: /調整參數重跑/ }))

    expect(screen.getByRole('button', { name: '重跑' })).toBeDisabled()
    expect(screen.getByTestId('retry-with-overrides')).toHaveTextContent('缺少事件匹配證據')
    await user.click(screen.getByRole('button', { name: '重跑' }))
    expect(runTask).not.toHaveBeenCalled()
  })

  it('有事件證據時可以重跑，證據隨新 run 一起帶過去', async () => {
    const user = userEvent.setup()
    const eventTrigger = { eventId: 'e1', matchedAt: '2026-08-16T00:00:00.000Z' }
    renderRetry({
      loopType: 'Proactive',
      evidence: { eventTrigger: eventTrigger as never },
    })
    await user.click(screen.getByRole('button', { name: /調整參數重跑/ }))
    await user.click(screen.getByRole('button', { name: '重跑' }))

    const input = runTask.mock.calls[0][0]
    expect(input.eventPreMatched).toBe(true)
    expect(input.overrides?.eventTrigger).toEqual(eventTrigger)
  })
})
