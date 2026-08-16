import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { previewDod, resolveUserDefinitionOfDone } from '../agent/dodPreview'
import { DodPreviewCard } from './DodPreviewCard'

const GOAL = '幫我比較三家供應商的報價並整理成表格，缺的資料標 N/A'

function renderCard(value?: string) {
  const preview = previewDod(GOAL, null)
  const onChange = vi.fn()
  const onSkip = vi.fn()
  render(
    <DodPreviewCard preview={preview} value={value} onChange={onChange} onSkip={onSkip} />,
  )
  return { preview, onChange, onSkip }
}

describe('DoD 送出前預覽', () => {
  it('Goal-based 才出現，Turn-based 的輕量對話不出現', () => {
    expect(previewDod(GOAL, null)).not.toBeNull()
    expect(previewDod('嗨', null)).toBeNull()
    expect(previewDod('謝謝', 'Turn-based')).toBeNull()
    expect(previewDod('   ', null)).toBeNull()
  })

  it('釘選 Goal 與 auto 判定給出不同的一句話原因', () => {
    expect(previewDod(GOAL, null)?.reason).toContain('Auto 判定為 Goal-based')
    expect(previewDod(GOAL, 'Goal-based')?.reason).toContain('已釘為目標迴圈')
  })

  it('preview 為 null 時整張卡不渲染', () => {
    render(<DodPreviewCard preview={null} value={undefined} onChange={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.queryByTestId('dod-preview-card')).not.toBeInTheDocument()
  })

  it('未編輯時顯示 auto-parse 的原文與原因', () => {
    const { preview } = renderCard()
    const card = screen.getByTestId('dod-preview-card')
    expect(card).toHaveTextContent(preview!.definitionOfDone)
    expect(card).toHaveTextContent('Auto 判定為 Goal-based')
    expect(card).not.toHaveTextContent('已編輯')
  })

  it('按編輯後可以改寫，每次輸入都同步回外層', async () => {
    const user = userEvent.setup()
    const { onChange, preview } = renderCard()
    await user.click(screen.getByRole('button', { name: '編輯' }))
    // 按下編輯就先把原文交回外層，避免使用者只刪一個字就變成「清空」
    expect(onChange).toHaveBeenCalledWith(preview!.definitionOfDone)

    await user.type(screen.getByRole('textbox', { name: '編輯驗收標準' }), '!')
    expect(onChange).toHaveBeenLastCalledWith(`${preview!.definitionOfDone}!`)
  })

  it('編輯過會標示「已編輯」', () => {
    renderCard('我自己的驗收標準')
    const card = screen.getByTestId('dod-preview-card')
    expect(card).toHaveTextContent('已編輯')
    expect(card).toHaveTextContent('我自己的驗收標準')
  })

  it('略過會通知外層收起卡片', async () => {
    const user = userEvent.setup()
    const { onSkip } = renderCard()
    await user.click(screen.getByRole('button', { name: '略過' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
})

describe('送出時解析使用者 DoD', () => {
  const preview = previewDod(GOAL, null)

  it('沒編輯 → undefined，行為與沒有這張卡完全相同', () => {
    expect(resolveUserDefinitionOfDone(undefined, preview)).toBeUndefined()
  })

  it('改回原樣或清空 → undefined，不當成使用者指定', () => {
    expect(resolveUserDefinitionOfDone(preview!.definitionOfDone, preview)).toBeUndefined()
    expect(resolveUserDefinitionOfDone('   ', preview)).toBeUndefined()
  })

  it('真的改過 → 帶著使用者的文字送出', () => {
    expect(resolveUserDefinitionOfDone('  三家報價都有含稅價  ', preview)).toBe('三家報價都有含稅價')
  })

  it('沒有預覽（非 Goal-based）時不夾帶任何 DoD', () => {
    expect(resolveUserDefinitionOfDone('三家報價都有含稅價', null)).toBeUndefined()
  })
})
