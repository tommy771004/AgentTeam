import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ThemePage } from '../components/SectionNav'
import {
  SettingsHeader,
  settingsInputCls,
} from '../components/settings/SettingsChrome'
import { LogViewer } from '../components/LogViewer'
import { ForkFromCheckpoint } from '../components/ForkFromCheckpoint'
import { useAgentStore } from '../store/agentStore'
import type { ArchiveRecord } from '../agent/types'
import { STATUS_ZH, loopTypeZh, statusZh } from '../i18n/zh'

const SECTIONS = [
  { id: 'archive', label: '執行封存', icon: 'inventory_2' },
  { id: 'logs', label: '日誌追蹤', icon: 'terminal' },
]

const PAGE_SIZE = 8

export function RecordsPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'logs' ? 'logs' : 'archive'
  const setTab = (id: string) => setParams(id === 'archive' ? {} : { tab: id })

  return (
    <ThemePage title="封存與日誌" sections={SECTIONS} activeId={tab} onChange={setTab}>
      {tab === 'archive' ? (
        <>
          <SettingsHeader
            title="執行封存"
            subtitle="歷史工作階段，可依 ID、狀態或目標搜尋。"
          />
          <ArchiveSection />
        </>
      ) : (
        <>
          <SettingsHeader title="日誌追蹤" subtitle="stdout、違規與中止詳情。" />
          <LogsSection />
        </>
      )}
    </ThemePage>
  )
}

function ArchiveSection() {
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
        r.loopType.toLowerCase().includes(q) ||
        (STATUS_ZH[r.status] || '').includes(q),
    )
  }, [archive, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  useEffect(() => {
    setPage(0)
  }, [query])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <p className="text-sm text-on-surface-variant">
          共 {archive.length} 筆封存紀錄。可依 ID、狀態或目標搜尋。
        </p>
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-outline"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋 ID、狀態或參數…"
            className={settingsInputCls + ' pl-10 pr-4 w-full md:w-72'}
          />
        </div>
      </div>

      <div className="app-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] tracking-widest text-on-surface-variant border-b border-white/10">
                <th className="px-4 py-3 font-semibold">狀態</th>
                <th className="px-4 py-3 font-semibold">執行 ID</th>
                <th className="px-4 py-3 font-semibold">目標</th>
                <th className="px-4 py-3 font-semibold">信心度</th>
                <th className="px-4 py-3 font-semibold">時間</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-on-surface-variant">
                    {archive.length === 0
                      ? '尚無封存。執行代理循環後會寫入歷史。'
                      : '沒有符合搜尋的結果。'}
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
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-[12px]">
                    {row.id}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant max-w-[220px] truncate">
                    {row.objective}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-[12px] text-primary">
                    {row.confidence != null ? `${(row.confidence * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-[11px] text-on-surface-variant">
                    {formatTs(row.timestamp)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className="text-primary hover:underline text-xs font-semibold"
                    >
                      檢視
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 text-xs text-on-surface-variant">
          <span>
            顯示 {filtered.length === 0 ? 0 : page * PAGE_SIZE + 1}–
            {Math.min(filtered.length, (page + 1) * PAGE_SIZE)} / {filtered.length}
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
            className="app-panel max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="font-semibold">{selected.id}</h3>
                <p className="text-xs text-on-surface-variant">
                  {loopTypeZh(selected.loopType)} · {statusZh(selected.status)}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-outline">
                <Icon name="close" size={22} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto custom-scrollbar space-y-3">
              <p className="text-sm">{selected.objective}</p>
              {selected.result && (
                <pre className="bg-surface border border-white/10 rounded-lg p-3 text-[12px] font-[family-name:var(--font-mono)] text-on-surface-variant whitespace-pre-wrap">
                  {selected.result}
                </pre>
              )}
              <div className="text-xs text-outline">
                日誌 {selected.logs.length} · 步驟 {selected.steps.length} · 迭代{' '}
                {selected.iterations}/{selected.maxIterations}
                {selected.tokensUsed != null ? ` · ${selected.tokensUsed} tokens` : ''}
                {selected.toolCalls?.length
                  ? ` · ${selected.toolCalls.length} 工具`
                  : ''}
              </div>
              <div className="pt-3 border-t border-line">
                <p className="text-[10px] tracking-widest text-outline mb-2">重跑</p>
                <ForkFromCheckpoint allowThreadPick />
              </div>
              {(selected.loadedCapabilityIds?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] tracking-widest text-outline mb-1.5">
                    CAPABILITIES
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selected.loadedCapabilityIds!.map((id) => (
                      <span
                        key={id}
                        className="px-1.5 py-0.5 rounded-md text-[10px] font-[family-name:var(--font-mono)] border border-primary/25 bg-primary/10 text-primary"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {selected.hitl &&
                (selected.hitl.allowed > 0 ||
                  selected.hitl.denied > 0 ||
                  selected.hitl.timedOut > 0) && (
                  <div>
                    <p className="text-[10px] tracking-widest text-outline mb-1.5">HITL</p>
                    <p className="text-[12px] font-[family-name:var(--font-mono)] text-on-surface-variant">
                      <span className="text-primary">允許 {selected.hitl.allowed}</span>
                      {' · '}
                      <span className="text-error">拒絕 {selected.hitl.denied}</span>
                      {' · '}
                      <span className="text-amber-300">逾時 {selected.hitl.timedOut}</span>
                    </p>
                    {!!selected.hitl.toolsTimedOut?.length && (
                      <p className="text-[11px] text-outline mt-1">
                        逾時工具：{selected.hitl.toolsTimedOut.join(', ')}
                      </p>
                    )}
                  </div>
                )}
              {(selected.toolCalls?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] tracking-widest text-outline mb-1.5">
                    工具稽核（{selected.toolCalls!.length}）
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                    {selected.toolCalls!.slice(0, 40).map((t) => (
                      <div
                        key={t.id}
                        className="text-[11px] font-[family-name:var(--font-mono)] flex gap-1.5"
                      >
                        <span className={t.ok ? 'text-primary' : 'text-error'}>
                          {t.ok ? '✓' : '✗'}
                        </span>
                        <span className="text-secondary shrink-0">{t.tool}</span>
                        <span className="text-outline truncate">
                          {(t.output || '').slice(0, 80)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LogsSection() {
  const navigate = useNavigate()
  const { agent, reset, draftInput } = useAgentStore()
  const halted =
    agent.status === 'halted' || agent.status === 'failed' || Boolean(agent.violation)
  const exitCode = agent.violation?.exitCode ?? (halted ? 1 : 0)

  const downloadLogs = () => {
    const lines = agent.logs.map((l) => `[${l.timestamp}] ${l.level.padEnd(8)} ${l.message}`)
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.id || 'stdout'}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-panel overflow-hidden border border-white/10 min-h-[60vh] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Icon name="warning" className={halted ? 'text-error' : 'text-primary'} size={22} filled />
          <h2 className="font-semibold">
            {halted ? '執行中斷' : '執行日誌'}
          </h2>
          {halted && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-error/20 text-error">
              結束碼 {exitCode}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={downloadLogs}
            className="p-1.5 rounded hover:bg-white/5 text-outline"
            title="下載"
          >
            <Icon name="download" size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0">
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-white/10 p-4 space-y-4">
          <div>
            <p className="text-[10px] tracking-widest text-outline mb-1">目前狀態</p>
            <p className={`font-semibold ${halted ? 'text-error' : 'text-primary'}`}>
              {halted ? '已中止' : statusZh(agent.status)}
            </p>
            <p className="text-sm text-on-surface-variant mt-1">
              {agent.haltReason ||
                agent.violation?.detail ||
                (agent.status === 'success'
                  ? '循環已成功完成並封存。'
                  : '此工作階段沒有嚴重違規紀錄。')}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-outline mb-1">追蹤脈絡</p>
            <dl className="text-xs space-y-2 text-on-surface-variant">
              <div>
                <dt className="text-outline">代理 ID</dt>
                <dd className="font-[family-name:var(--font-mono)] text-primary break-all">
                  {agent.id || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-outline">任務定義</dt>
                <dd>{agent.objective || '—'}</dd>
              </div>
              <div>
                <dt className="text-outline">工具 / Token</dt>
                <dd>
                  {agent.toolCalls.length} 次工具 · {agent.tokensUsed} tokens
                </dd>
              </div>
            </dl>
          </div>
          {agent.violation && (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3">
              <p className="font-semibold text-error text-sm">{agent.violation.code}</p>
              <p className="text-sm text-on-surface-variant mt-1">{agent.violation.detail}</p>
            </div>
          )}
          <button
            type="button"
            onClick={async () => {
              const input = draftInput || agent.objective
              reset()
              if (!input) {
                navigate('/')
                return
              }
              navigate('/')
              const { runTask } = await import('../agent/taskRunCoordinator')
              await runTask({
                sourceKind: 'retry',
                objective: input,
                title: '日誌重啟',
                loopType: agent.loopConfig.loopType || 'Goal-based',
                eventPreMatched: agent.loopConfig.loopType === 'Proactive',
                sourceLabel: '自日誌重新啟動',
                meta: { eventTrigger: agent.eventTrigger },
              })
            }}
            className="w-full py-2 rounded-lg border border-white/15 text-xs font-semibold hover:border-primary/40 hover:text-primary flex items-center justify-center gap-1"
          >
            <Icon name="refresh" size={16} />
            重新啟動代理
          </button>
        </aside>
        <section className="lg:col-span-8 min-h-[320px] bg-[#060e20]">
          {agent.logs.length === 0 ? (
            <p className="p-6 text-sm text-outline">尚無日誌。請先執行一次代理循環。</p>
          ) : (
            <LogViewer logs={agent.logs} />
          )}
        </section>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: ArchiveRecord['status'] }) {
  const color =
    status === 'success'
      ? 'bg-primary text-primary'
      : status === 'failed' || status === 'halted'
        ? 'bg-error text-error'
        : 'bg-secondary text-secondary'
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${color.split(' ')[1]}`}>
      <span className={`w-2 h-2 rounded-full ${color.split(' ')[0]}`} />
      {statusZh(status)}
    </span>
  )
}

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
