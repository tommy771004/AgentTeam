import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DodVerdict } from '../agent/types'
import { DodScorecard } from './DodScorecard'

describe('DodScorecard', () => {
  it('最終輪語意驗收通過 → 已驗證完成＋收斂歷程', () => {
    const verdicts: DodVerdict[] = [
      { iteration: 1, met: false, semantic: true, confidence: 0.4, missing: ['a', 'b'], evaluatedAt: 't1' },
      { iteration: 2, met: false, semantic: true, confidence: 0.6, missing: ['b'], evaluatedAt: 't2' },
      { iteration: 3, met: true, semantic: true, confidence: 0.95, missing: [], evaluatedAt: 't3' },
    ]
    render(<DodScorecard verdicts={verdicts} />)
    const card = screen.getByTestId('dod-scorecard')
    expect(card).toHaveTextContent('DoD 已驗證完成')
    expect(card).toHaveTextContent('3 輪')
    expect(card).toHaveTextContent('第1輪剩 2 → 第2輪剩 1 → 第3輪剩 0')
  })

  it('未達成 → 缺口數與清單', () => {
    const verdicts: DodVerdict[] = [
      { iteration: 6, met: false, semantic: true, confidence: 0.5, missing: ['e2e 未過', '文件未更新'], evaluatedAt: 't' },
    ]
    render(<DodScorecard verdicts={verdicts} />)
    const card = screen.getByTestId('dod-scorecard')
    expect(card).toHaveTextContent('DoD 未達成 · 剩 2 項缺口')
    expect(card).toHaveTextContent('e2e 未過')
  })

  it('啟發式 met → 執行完畢（未驗證）', () => {
    const verdicts: DodVerdict[] = [
      { iteration: 1, met: true, semantic: false, confidence: 0.8, missing: [], evaluatedAt: 't' },
    ]
    render(<DodScorecard verdicts={verdicts} />)
    expect(screen.getByTestId('dod-scorecard')).toHaveTextContent('執行完畢（未驗證）')
  })

  it('外部 CLI run 無判定 → 誠實標章', () => {
    render(<DodScorecard verdicts={undefined} runnerKind="external" />)
    expect(screen.getByTestId('dod-scorecard')).toHaveTextContent('外部 CLI 執行結束')
  })

  it('builtin 無判定 → 不渲染', () => {
    const { container } = render(<DodScorecard verdicts={undefined} runnerKind="builtin" />)
    expect(screen.queryByTestId('dod-scorecard')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})
