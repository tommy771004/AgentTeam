import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useThreadStore, type ThreadBubble } from '../store/threadStore'
import { ChatBubble } from './ChatBubble'

// rewind 按鈕只在有 Electron 快照橋時出現
beforeAll(() => {
  ;(window as unknown as { subagents: unknown }).subagents = { rewind: {} }
})

const rewindResult = {
  ok: true,
  restored: [],
  conflicts: [],
  errors: [],
  removedBubbles: 0,
}

const bubble: ThreadBubble = {
  id: 'bubble-1',
  role: 'user',
  content: '幫我整理 inbox',
  at: new Date(0).toISOString(),
}

function setupRewindSpy() {
  const rewindToBubble = vi.fn(async () => rewindResult)
  useThreadStore.setState({ activeId: 'thread-1', rewindToBubble })
  return rewindToBubble
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatBubble 回捲確認', () => {
  it('點回捲只開啟確認面板，還沒有動到對話', async () => {
    const user = userEvent.setup()
    const rewindToBubble = setupRewindSpy()
    render(<ChatBubble bubble={bubble} />)

    await user.click(screen.getByRole('button', { name: '回捲到此訊息' }))
    expect(screen.getByTestId('confirm-sheet')).toBeInTheDocument()
    expect(rewindToBubble).not.toHaveBeenCalled()
  })

  it('取消 → 面板關閉且不觸發 rewind', async () => {
    const user = userEvent.setup()
    const rewindToBubble = setupRewindSpy()
    render(<ChatBubble bubble={bubble} />)

    await user.click(screen.getByRole('button', { name: '回捲到此訊息' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByTestId('confirm-sheet')).not.toBeInTheDocument()
    expect(rewindToBubble).not.toHaveBeenCalled()
  })

  it('確認 → 觸發一次 rewind，帶上這個氣泡的 id', async () => {
    const user = userEvent.setup()
    const rewindToBubble = setupRewindSpy()
    render(<ChatBubble bubble={bubble} />)

    await user.click(screen.getByRole('button', { name: '回捲到此訊息' }))
    await user.click(screen.getByRole('button', { name: '回捲' }))
    expect(rewindToBubble).toHaveBeenCalledTimes(1)
    expect(rewindToBubble).toHaveBeenCalledWith('thread-1', 'bubble-1')
  })

  it('沒有原生 confirm 參與決策', async () => {
    const user = userEvent.setup()
    setupRewindSpy()
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ChatBubble bubble={bubble} />)

    await user.click(screen.getByRole('button', { name: '回捲到此訊息' }))
    expect(nativeConfirm).not.toHaveBeenCalled()
  })
})
