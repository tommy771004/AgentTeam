import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfidenceRing } from './ConfidenceRing'

describe('ConfidenceRing', () => {
  it('以預設標籤呈現格式化的信心值', () => {
    render(<ConfidenceRing value={0.7} />)
    expect(screen.getByText('0.70')).toBeInTheDocument()
    expect(screen.getByText('信心度')).toBeInTheDocument()
  })

  it('鉗制超出 [0,1] 的值', () => {
    const { rerender } = render(<ConfidenceRing value={1.5} />)
    expect(screen.getByText('1.00')).toBeInTheDocument()
    rerender(<ConfidenceRing value={-0.2} />)
    expect(screen.getByText('0.00')).toBeInTheDocument()
  })

  it('接受自訂標籤', () => {
    render(<ConfidenceRing value={0.42} label="DoD" />)
    expect(screen.getByText('DoD')).toBeInTheDocument()
  })
})
