import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmSheet } from './ConfirmSheet'

function renderSheet(overrides: Partial<Parameters<typeof ConfirmSheet>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmSheet
      open
      title="回捲到此訊息？"
      description="之後的對話會被截斷。"
      confirmLabel="回捲"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onConfirm, onCancel }
}

describe('ConfirmSheet 共用確認面板', () => {
  it('關閉時不渲染任何東西', () => {
    renderSheet({ open: false })
    expect(screen.queryByTestId('confirm-sheet')).not.toBeInTheDocument()
  })

  it('開啟時是 modal dialog，標題與說明都看得到', () => {
    renderSheet()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('回捲到此訊息？')
    expect(dialog).toHaveTextContent('之後的對話會被截斷。')
  })

  it('開啟時焦點落在確認鍵上（純鍵盤可直接決定）', () => {
    renderSheet()
    expect(screen.getByRole('button', { name: '回捲' })).toHaveFocus()
  })

  it('Esc 取消，且不會誤觸確認', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderSheet()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('點背景取消；點面板本身不會取消', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderSheet()
    await user.click(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('確認鍵呼叫 onConfirm 一次', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderSheet()
    await user.click(screen.getByRole('button', { name: '回捲' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('busy 時兩顆按鈕都鎖住，無法重複送出', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderSheet({ busy: true })
    await user.click(screen.getByRole('button', { name: '回捲' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
