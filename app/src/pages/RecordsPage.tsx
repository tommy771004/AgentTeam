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
import { WorkingStateDiagnostics } from '../components/WorkingStateView'
import { RunStatusSurface } from '../components/RunStatusSurface.tsx'
import { useAgentStore } from '../store/agentStore'
import type { ArchiveRecord } from '../agent/types'
import { recordRunnerDeclaration, turnRecordEntries } from '../agent/turnRecord'
import { formatRunnerCapabilitiesSummary, projectRunnerCapabilitySnapshot } from '../agent/runners'
import { projectWorkingStateEntries, unavailableWorkingStateProjection } from '../agent/workingStateProjection'
import { deriveRunLifecycle } from '../agent/runLifecycle.ts'
import { projectRunStatusSurface } from '../agent/runStatusSurface.ts'
import { STATUS_ZH, loopTypeZh, statusZh } from '../i18n/zh'

const SECTIONS = [
  { id: 'archive', label: '執行封存', icon: 'inventory_2' },
  { id: 'logs', label: '日誌追蹤', icon: 'terminal' },
]

const PAGE_SIZE = 8

function archiveWorkingState(archive: ArchiveRecord) {
  return archive.turnRecord
    ? projectWorkingStateEntries(turnRecordEntries(archive.turnRecord), false)
    : unavailableWorkingStateProjection(archive.id)
}

function ArchiveRunStatus({ archive }: { archive: ArchiveRecord }) {
  const snapshot = useMemo(() => projectRunnerCapabilitySnapshot(
    recordRunnerDeclaration(archive.turnRecord),
    archive.runnerCapabilities,
  ), [archive.turnRecord, archive.runnerCapabilities])
  const workingState = useMemo(() => archiveWorkingState(archive), [archive])
  const lifecycle = deriveRunLifecycle({
    status: archive.status === 'warning' ? 'success' : archive.status,
    terminal: archive.status !== 'running',
    active: archive.status === 'running',
    orchestration: {
      iterations: archive.iterations,
      maxIterations: archive.maxIterations,
      executionKind: archive.executionKind,
    },
  })
  const projection = projectRunStatusSurface({
    lifecycle,
    capabilities: snapshot.capabilities,
    isExternal: archive.executionKind === 'external',
    activity: {
      events: [],
      fileChanges: [],
      terminal: archive.status === 'running' ? null : true,
      updatedAt: Date.parse(archive.timestamp) || 0,
      interaction: null,
    },
    workingState,
  })
  return <RunStatusSurface projection={projection} startedAt={0} />
}

function ArchiveRunnerDiagnostics({ archive }: { archive: ArchiveRecord }) {
  const snapshot = useMemo(() => projectRunnerCapabilitySnapshot(
    recordRunnerDeclaration(archive.turnRecord),
    archive.runnerCapabilities,
  ), [archive.turnRecord, archive.runnerCapabilities])
  const workingState = useMemo(() => archiveWorkingState(archive), [archive])
  const label = snapshot.guarantee === 'host-verified'
    ? 'Host verified'
    : snapshot.guarantee === 'reduced'
      ? 'Reduced guarantee'
      : snapshot.guarantee === 'run-snapshot'
        ? 'Run snapshot'
        : 'Unavailable / degraded'
  return (
    <details className="border-b border-line pb-3">
      <summary className="cursor-pointer text-xs font-semibold text-on-surface-variant">執行資訊</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs leading-relaxed text-on-surface-variant">
          Runner guarantee: {label}. {formatRunnerCapabilitiesSummary(snapshot.capabilities)}
        </p>
        <WorkingStateDiagnostics projection={workingState} />
      </div>
    </details>
  )
}

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
              aria-label="上一頁"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="flex size-8 items-center justify-center rounded-lg bg-transparent text-outline transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-30"
            >
              <Icon name="chevron_left" size={18} />
            </button>
            <button
              type="button"
              aria-label="下一頁"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="flex size-8 items-center justify-center rounded-lg bg-transparent text-outline transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-30"
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
              <div className="overflow-hidden rounded-control border border-line">
                <ArchiveRunStatus archive={selected} />
              </div>
              <ArchiveRunnerDiagnostics archive={selected} />
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
    <div className="flex flex-col">
      <div className="flex flex-1 min-h-0 flex-col">
        <aside className="grid grid-cols-1 gap-4 border-b border-white/10 p-4 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)]">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] tracking-widest text-outline mb-1">目前狀態</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`font-semibold ${halted ? 'text-error' : 'text-primary'}`}>
                    {halted ? '已中止' : statusZh(agent.status)}
                  </p>
                  {halted && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-error/20 text-error">
                      結束碼 {exitCode}
                    </span>
                  )}
                </div>
                <p className="text-sm text-on-surface-variant mt-1">
                  {agent.haltReason ||
                    agent.violation?.detail ||
                    (agent.status === 'success'
                      ? '循環已成功完成並封存。'
                      : '此工作階段沒有嚴重違規紀錄。')}
                </p>
              </div>
              {agent.logs.length > 0 && (
                <button
                  type="button"
                  onClick={downloadLogs}
                  className="shrink-0 p-1.5 rounded hover:bg-white/5 text-outline"
                  title="下載日誌"
                  aria-label="下載日誌"
                >
                  <Icon name="download" size={16} />
                </button>
              )}
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
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-outline mb-2">追蹤脈絡</p>
            <dl className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025] text-xs text-on-surface-variant divide-y divide-white/10">
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 px-3 py-2.5">
                <dt className="text-outline leading-5">代理 ID</dt>
                <dd className="min-w-0 font-[family-name:var(--font-mono)] text-primary break-all leading-5">
                  {agent.id || '—'}
                </dd>
              </div>
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 px-3 py-2.5">
                <dt className="text-outline leading-5">任務定義</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words leading-5 text-on-surface">
                  {agent.objective || '—'}
                </dd>
              </div>
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 px-3 py-2.5">
                <dt className="text-outline leading-5">工具 / Token</dt>
                <dd className="min-w-0 leading-5 tabular-nums">
                  {agent.toolCalls.length} 次工具 · {agent.tokensUsed} tokens
                </dd>
              </div>
            </dl>
          </div>
        </aside>
        {agent.logs.length > 0 && (
          <section className="min-h-[320px] flex-1 bg-[#060e20]">
            <LogViewer logs={agent.logs} />
          </section>
        )}
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
