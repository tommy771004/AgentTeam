import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RunSummaryCard } from './RunSummaryCard'

// 票 08：匯出動作走 reportExport 縫隙——mock 後斷言呼叫與格式
vi.mock('../agent/reportExport', () => ({
  collectReportSource: vi.fn(() => ({ runId: 'run-x', lineageRunIds: ['run-x'], runnerKind: 'builtin', degraded: [] })),
  exportRunReport: vi.fn(async ({ format }: { format: string }) => ({
    ok: true,
    message: `已寫入 /tmp/reports/report-run-x.${format}`,
  })),
  reportFileName: vi.fn(() => 'report-run-x.md'),
}))

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

  it('展開後可匯出報告（MD/HTML），訊息回顯', async () => {
    const user = userEvent.setup()
    const { exportRunReport } = await import('../agent/reportExport')
    render(
      <MemoryRouter>
        <RunSummaryCard summary={{ ...baseSummary, runId: 'run-x' }} threadId="t-1" />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /已變更|執行過程/ }))
    await user.click(screen.getByRole('button', { name: '匯出 Markdown' }))
    expect(await screen.findByText(/report-run-x\.md/)).toBeInTheDocument()
    expect(exportRunReport).toHaveBeenCalledWith(expect.objectContaining({ format: 'md' }))

    await user.click(screen.getByRole('button', { name: '匯出 HTML' }))
    expect(exportRunReport).toHaveBeenCalledWith(expect.objectContaining({ format: 'html' }))
  })
})
