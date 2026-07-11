/** @deprecated Prefer RecordsPage. Route redirects to /records. */
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { useAgentStore } from '../store/agentStore'
import type { ArchiveRecord } from '../agent/types'

const PAGE_SIZE = 8

export function ArchivePage() {
  const { archive, loadArchive } = useAgentStore()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<ArchiveRecord | null>(null)

  useEffect(() => {
    void loadArchive()
  }, [loadArchive])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return archive
    return archive.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.objective.toLowerCase().includes(q) ||
        r.loopType.toLowerCase().includes(q),
    )
  }, [archive, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  useEffect(() => {
    setPage(0)
  }, [query])

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-10 min-h-full flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-sora)] text-3xl font-semibold text-on-surface mb-1">
            Execution Archive
          </h1>
          <p className="text-on-surface-variant">Review, audit, and reload past session data.</p>
        </div>
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-outline"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID, Status, or Parameter..."
            className="bg-surface-container border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-on-surface placeholder:text-outline outline-none focus:border-primary/40 w-full md:w-80"
          />
        </div>
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] tracking-widest uppercase text-on-surface-variant border-b border-white/10">
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Execution ID</th>
                <th className="px-4 py-3 font-semibold">Objective</th>
                <th className="px-4 py-3 font-semibold">Confidence</th>
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-on-surface-variant">
                    {archive.length === 0
                      ? 'No executions archived yet. Run an agent loop to populate history.'
                      : 'No results match your search.'}
                  </td>
                </tr>
              )}
              {pageItems.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                >
                  <td className="px-4 py-3">
                    <StatusDot status={row.status} />
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-[13px] text-on-surface">
                    {row.id}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant max-w-[240px] truncate">
                    {row.objective}
                  </td>
                  <td className="px-4 py-3">
                    {row.confidence != null ? (
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <span
                          className={`font-[family-name:var(--font-mono)] text-[13px] ${
                            row.status === 'failed' ? 'text-outline' : 'text-primary'
                          }`}
                        >
                          {(row.confidence * 100).toFixed(1)}%
                        </span>
                        <div className="flex-1 h-1 bg-surface-container-highest rounded-full overflow-hidden max-w-[60px]">
                          <div
                            className={`h-full rounded-full ${
                              row.status === 'warning' ? 'bg-secondary' : 'bg-primary'
                            }`}
                            style={{ width: `${Math.min(100, row.confidence * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-outline">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-[12px] text-on-surface-variant">
                    {formatTs(row.timestamp)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className="text-primary hover:underline text-xs font-semibold tracking-wider uppercase"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-xs text-on-surface-variant">
          <span>
            Showing {filtered.length === 0 ? 0 : page * PAGE_SIZE + 1}–
            {Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length} executions
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded hover:bg-white/5 disabled:opacity-30"
            >
              <Icon name="chevron_left" size={18} />
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded hover:bg-white/5 disabled:opacity-30"
            >
              <Icon name="chevron_right" size={18} />
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setSelected(null)}
        >
          <div
            className="glass-panel rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="font-[family-name:var(--font-sora)] font-semibold">{selected.id}</h3>
                <p className="text-xs text-on-surface-variant">{selected.loopType}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-outline hover:text-on-surface">
                <Icon name="close" size={22} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto custom-scrollbar space-y-3">
              <p className="text-sm text-on-surface">{selected.objective}</p>
              <StatusDot status={selected.status} />
              {selected.result && (
                <pre className="bg-surface border border-white/10 rounded-lg p-3 text-[12px] font-[family-name:var(--font-mono)] text-on-surface-variant whitespace-pre-wrap">
                  {selected.result}
                </pre>
              )}
              <div className="text-xs text-outline">
                Logs: {selected.logs.length} · Steps: {selected.steps.length} · Iterations:{' '}
                {selected.iterations}/{selected.maxIterations}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: ArchiveRecord['status'] }) {
  const map = {
    success: { color: 'bg-primary text-primary', label: 'Success' },
    failed: { color: 'bg-error text-error', label: 'Failed' },
    warning: { color: 'bg-secondary text-secondary', label: 'Warning' },
    running: { color: 'bg-primary text-primary', label: 'Running' },
    halted: { color: 'bg-error text-error', label: 'Halted' },
  } as const
  const m = map[status] || map.warning
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${m.color.split(' ')[1]}`}>
      <span className={`w-2 h-2 rounded-full ${m.color.split(' ')[0]}`} />
      {m.label}
    </span>
  )
}

function formatTs(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('sv-SE').replace('T', ' ').slice(0, 19)
  } catch {
    return iso
  }
}
