import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RunSummaryCard } from './RunSummaryCard'

const baseSummary = {
  status: 'success' as const,
  durationMs: 1200,
  operations: [
    { id: 'op1', kind: 'status', title: '完成', ok: true },
  ],
  files: [{ path: 'src/a.ts', action: 'edit', added: 2, removed: 1 }],
  plan: [],
  agents: [],
}

describe('RunSummaryCard 模擬執行章', () => {
  it('simulated: true 顯示「模擬執行」章', () => {
    render(
      <MemoryRouter>
        <RunSummaryCard summary={{ ...baseSummary, simulated: true }} />
      </MemoryRouter>,
    )
    expect(screen.getByText('模擬執行')).toBeInTheDocument()
  })

  it('未標記或 false 不顯示章', () => {
    const { rerender } = render(
      <MemoryRouter>
        <RunSummaryCard summary={{ ...baseSummary }} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('模擬執行')).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <RunSummaryCard summary={{ ...baseSummary, simulated: false }} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('模擬執行')).not.toBeInTheDocument()
  })
})
