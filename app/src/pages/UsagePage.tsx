import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { formatTokens, formatTokensCompact, formatUsd } from '../agent/contextUsageView'
import { backfillUsageLedger, loadUsageLedger } from '../agent/usageLedgerClient'
import {
  emptyUsageLedger,
  projectUsageLedger,
  type UsageBucket,
  type UsageLedger,
  type UsageQuery,
  type UsageRange,
  type UsageRankingRow,
  type UsageRunStatus,
} from '../agent/usageLedger'
import { useAgentStore } from '../store/agentStore'

const RANGE_OPTIONS: Array<{ value: UsageRange; label: string }> = [
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自訂' },
]

const selectClass = 'min-h-9 rounded-control border border-line bg-surface px-3 text-[12px] text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35'

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
}

function shortProject(value: string): string {
  if (value === '未綁定專案') return value
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || value
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-[130px] border-l border-line pl-4 first:border-l-0 first:pl-0">
      <dt className="text-[11px] text-outline">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-mono)] text-[22px] font-semibold tabular-nums text-on-surface">{value}</dd>
      <p className="mt-1 text-[10px] leading-snug text-on-surface-variant">{detail}</p>
    </div>
  )
}

function BucketDetail({ bucket }: { bucket?: UsageBucket }) {
  if (!bucket) return <p className="text-xs text-on-surface-variant">選取一個時間柱查看實測分解。</p>
  const split = [
    bucket.tokens.input === undefined ? null : `輸入 ${formatTokens(bucket.tokens.input)}`,
    bucket.tokens.output === undefined ? null : `輸出 ${formatTokens(bucket.tokens.output)}`,
    bucket.tokens.cachedRead === undefined ? null : `快取讀 ${formatTokens(bucket.tokens.cachedRead)}`,
    bucket.tokens.cachedWrite === undefined ? null : `快取寫 ${formatTokens(bucket.tokens.cachedWrite)}`,
  ].filter(Boolean)
  return (
    <div aria-live="polite">
      <p className="font-[family-name:var(--font-mono)] text-[13px] tabular-nums text-on-surface">
        {bucket.label} · {formatTokens(bucket.tokens.total)} tokens · {bucket.runs} runs
        {bucket.costUsd === undefined ? '' : ` · ${formatUsd(bucket.costUsd)}`}
      </p>
      <p className="mt-1 text-[10px] text-on-surface-variant">
        {split.length ? split.join(' · ') : 'runner 只回報總量，沒有 token 分解'}
      </p>
    </div>
  )
}

function UsageTrajectory({ buckets, selectedKey, onSelect }: {
  buckets: UsageBucket[]
  selectedKey?: string
  onSelect: (key: string) => void
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.tokens.total))
  const maxCost = Math.max(0, ...buckets.map((bucket) => bucket.costUsd ?? 0))
  return (
    <div>
      <div className="overflow-x-auto custom-scrollbar pb-2">
        <div className="flex h-56 min-w-[620px] items-end gap-1 border-b border-line px-1" role="list" aria-label="各期間 token 用量">
          {buckets.map((bucket, index) => {
            const height = Math.max(3, (bucket.tokens.total / max) * 180)
            const selected = selectedKey === bucket.key
            return (
              <button
                key={bucket.key}
                type="button"
                role="listitem"
                aria-label={`${bucket.label}，${formatTokens(bucket.tokens.total)} tokens，${bucket.runs} runs`}
                aria-pressed={selected}
                onClick={() => onSelect(bucket.key)}
                className="group flex h-full min-w-2 flex-1 items-end justify-center rounded-t-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span
                  className={`block w-full rounded-t-sm transition-colors motion-reduce:transition-none ${selected ? 'bg-primary' : 'bg-primary/35 group-hover:bg-primary/60'}`}
                  style={{ height }}
                />
                {(index === 0 || index === buckets.length - 1 || buckets.length <= 12) && (
                  <span className="sr-only">{bucket.label}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between font-[family-name:var(--font-mono)] text-[9px] text-outline">
        <span>{buckets[0]?.label}</span>
        <span>{buckets.at(-1)?.label}</span>
      </div>
      {maxCost > 0 && (
        <div className="mt-6" aria-label="已知成本趨勢">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-xs font-semibold text-on-surface">已知成本</h3>
            <span className="text-[10px] text-on-surface-variant">只包含有定價的 runs</span>
          </div>
          <div className="flex h-10 items-end gap-1 border-b border-line/70 px-1" aria-hidden="true">
            {buckets.map((bucket) => (
              <span
                key={bucket.key}
                className="min-w-1 flex-1 bg-on-surface/25"
                style={{ height: bucket.costUsd === undefined ? 0 : Math.max(2, (bucket.costUsd / maxCost) * 36) }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RankingTable({ title, rows, project = false }: { title: string; rows: UsageRankingRow[]; project?: boolean }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-[13px] font-semibold text-on-surface">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-left text-xs">
          <thead className="border-b border-line text-[10px] text-outline">
            <tr><th className="pb-2 font-medium">名稱</th><th className="pb-2 text-right font-medium">Tokens</th><th className="pb-2 text-right font-medium">Runs</th><th className="pb-2 text-right font-medium">Avg/run</th><th className="pb-2 text-right font-medium">成本</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((row) => (
              <tr key={row.key} className="border-b border-line/60">
                <td className="max-w-[210px] truncate py-2.5 text-on-surface" title={row.key}>{project ? shortProject(row.key) : row.key}</td>
                <td className="py-2.5 text-right font-[family-name:var(--font-mono)] tabular-nums">{formatTokensCompact(row.tokens)}</td>
                <td className="py-2.5 text-right font-[family-name:var(--font-mono)] tabular-nums">{row.runs}</td>
                <td className="py-2.5 text-right font-[family-name:var(--font-mono)] tabular-nums">{formatTokensCompact(row.averageTokens)}</td>
                <td className="py-2.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-on-surface-variant">{row.costUsd === undefined ? '—' : formatUsd(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function UsagePage() {
  const navigate = useNavigate()
  const archive = useAgentStore((state) => state.archive)
  const loadArchive = useAgentStore((state) => state.loadArchive)
  const [ledger, setLedger] = useState<UsageLedger>(() => emptyUsageLedger())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState<UsageQuery>({ range: 'all' })
  const [selectedKey, setSelectedKey] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loadArchive()
        const currentArchive = useAgentStore.getState().archive
        const next = await backfillUsageLedger(currentArchive)
        if (!cancelled) setLedger(next)
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setLedger(await loadUsageLedger())
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    const refresh = window.setInterval(() => {
      void loadUsageLedger().then((next) => { if (!cancelled) setLedger(next) })
    }, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(refresh)
    }
  }, [loadArchive])

  const projection = useMemo(() => projectUsageLedger(ledger, query), [ledger, query])
  useEffect(() => {
    if (!projection.buckets.length) setSelectedKey(undefined)
    else if (!selectedKey || !projection.buckets.some((bucket) => bucket.key === selectedKey)) setSelectedKey(projection.buckets.at(-1)?.key)
  }, [projection.buckets, selectedKey])

  const selectedBucket = projection.buckets.find((bucket) => bucket.key === selectedKey)
  const runners = unique(ledger.entries.map((entry) => entry.runner))
  const models = unique(ledger.entries.flatMap((entry) => entry.models))
  const projects = unique(ledger.entries.map((entry) => entry.projectRoot))
  const archiveIds = useMemo(() => new Set(archive.map((record) => record.id)), [archive])
  const pricedCoverage = projection.totals.runs ? Math.round(projection.totals.pricedRuns / projection.totals.runs * 100) : 0
  const maxBreakdown = Math.max(1, ...projection.breakdown.map((row) => row.value))

  const patch = (next: Partial<UsageQuery>) => setQuery((current) => ({ ...current, ...next }))

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-background">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col px-5 pb-16 pt-7 md:px-8">
        <header className="border-b border-line pb-5">
          <div className="flex items-center gap-3">
            <Icon name="monitoring" size={22} className="text-primary" />
            <h1 className="text-xl font-semibold tracking-tight text-on-surface">用量統計</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            永久保存 provider 實測用量；封存或對話被清除後，統計仍會保留。
          </p>
          <p className="mt-1 text-[10px] text-outline">
            涵蓋自 {formatDate(ledger.entries.at(-1)?.settledAt || ledger.createdAt)} · — 表示 provider 未回報，不以 0 代替
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-2 border-b border-line py-4" aria-label="用量篩選">
          <label className="flex flex-col gap-1 text-[10px] text-outline">期間
            <select className={selectClass} value={query.range || 'all'} onChange={(event) => patch({ range: event.target.value as UsageRange })}>
              {RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {query.range === 'custom' && <>
            <label className="flex flex-col gap-1 text-[10px] text-outline">開始<input className={selectClass} type="date" value={query.from || ''} onChange={(event) => patch({ from: event.target.value })} /></label>
            <label className="flex flex-col gap-1 text-[10px] text-outline">結束<input className={selectClass} type="date" value={query.to || ''} onChange={(event) => patch({ to: event.target.value })} /></label>
          </>}
          <label className="flex flex-col gap-1 text-[10px] text-outline">Runner
            <select className={selectClass} value={query.runner || ''} onChange={(event) => patch({ runner: event.target.value || undefined })}><option value="">全部</option>{runners.map((value) => <option key={value}>{value}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-outline">Model
            <select className={selectClass} value={query.model || ''} onChange={(event) => patch({ model: event.target.value || undefined })}><option value="">全部</option>{models.map((value) => <option key={value}>{value}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-outline">Project
            <select className={selectClass + ' max-w-[190px]'} value={query.projectRoot || ''} onChange={(event) => patch({ projectRoot: event.target.value || undefined })}><option value="">全部</option>{projects.map((value) => <option key={value} value={value}>{shortProject(value)}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-outline">狀態
            <select className={selectClass} value={query.status || ''} onChange={(event) => patch({ status: (event.target.value || undefined) as UsageRunStatus | undefined })}><option value="">全部</option><option value="success">成功</option><option value="failed">失敗</option><option value="halted">已停止</option><option value="warning">警告</option></select>
          </label>
        </div>

        {error && <p className="mt-4 text-xs text-error">載入部分資料失敗：{error}</p>}
        {loading ? (
          <div className="py-20 text-center text-sm text-on-surface-variant">正在整理永久用量…</div>
        ) : projection.entries.length === 0 ? (
          <div className="py-24 text-center">
            <Icon name="data_usage" size={28} className="mx-auto text-outline" />
            <p className="mt-3 text-sm font-semibold text-on-surface">尚無實測用量</p>
            <p className="mt-1 text-xs text-on-surface-variant">完成一次 provider 有回報 token 的 run 後，這裡會開始累積。</p>
          </div>
        ) : <>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-6 border-b border-line py-6 md:grid-cols-5">
            <Metric label="總用量" value={formatTokensCompact(projection.totals.tokens)} detail={`${formatTokens(projection.totals.tokens)} tokens`} />
            <Metric label="已知成本" value={projection.totals.costUsd === undefined ? '—' : formatUsd(projection.totals.costUsd)} detail={`${projection.totals.pricedRuns}/${projection.totals.runs} runs 有定價 · ${pricedCoverage}%`} />
            <Metric label="Runs" value={String(projection.totals.runs)} detail={`${formatDate(projection.totals.firstRecordedAt)} 起`} />
            <Metric label="平均 / run" value={formatTokensCompact(projection.totals.averageTokens)} detail="依實測總量計算" />
            <Metric label="快取讀" value={projection.totals.cachedRead === undefined ? '—' : formatTokensCompact(projection.totals.cachedRead)} detail="僅統計有回報的 runs" />
          </dl>

          <section className="border-b border-line py-7">
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[15px] font-semibold text-on-surface">用量軌跡</h2>
              <span className="text-[10px] text-on-surface-variant">{projection.bucketUnit === 'day' ? '每日' : projection.bucketUnit === 'week' ? '每週' : '每月'} · 點選柱狀查看實測分解</span>
            </div>
            <UsageTrajectory buckets={projection.buckets} selectedKey={selectedKey} onSelect={setSelectedKey} />
            <div className="mt-4 min-h-10 border-l-2 border-primary/60 pl-3"><BucketDetail bucket={selectedBucket} /></div>
          </section>

          <section className="grid gap-8 border-b border-line py-7 lg:grid-cols-[minmax(260px,0.8fr)_minmax(420px,1.4fr)]">
            <div>
              <h2 className="text-[15px] font-semibold text-on-surface">用量結構</h2>
              <p className="mt-1 text-[10px] text-on-surface-variant">每列保留自己的回報覆蓋率，不把缺值算成 0。</p>
              <div className="mt-5 space-y-4">
                {projection.breakdown.map((row) => (
                  <div key={row.key}>
                    <div className="flex items-baseline justify-between gap-3 text-xs"><span>{row.label}</span><span className="font-[family-name:var(--font-mono)] tabular-nums">{row.reportedRuns ? formatTokens(row.value) : '—'} <span className="text-[9px] text-outline">· {row.reportedRuns}/{projection.totals.runs} runs</span></span></div>
                    <div className="mt-1.5 h-1.5 bg-inset"><div className="h-full bg-primary/65" style={{ width: `${row.reportedRuns ? row.value / maxBreakdown * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <RankingTable title="Runner 用量" rows={projection.runnerRanking} />
          </section>

          <div className="grid gap-8 border-b border-line py-7 lg:grid-cols-2">
            <RankingTable title="Model 用量" rows={projection.modelRanking} />
            <RankingTable title="Project 用量" rows={projection.projectRanking} project />
          </div>

          <section className="py-7">
            <h2 className="text-[15px] font-semibold text-on-surface">最近 runs</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-line text-[10px] text-outline"><tr><th className="pb-2 font-medium">時間</th><th className="pb-2 font-medium">Run ID</th><th className="pb-2 font-medium">Runner / Model</th><th className="pb-2 font-medium">狀態</th><th className="pb-2 text-right font-medium">Tokens</th><th className="pb-2 text-right font-medium">成本</th></tr></thead>
                <tbody>{projection.entries.slice(0, 20).map((entry) => (
                  <tr key={entry.runId} className="border-b border-line/60">
                    <td className="py-2.5 text-on-surface-variant">{formatDate(entry.settledAt)}</td>
                    <td className="py-2.5 font-[family-name:var(--font-mono)] text-[11px]">
                      {archiveIds.has(entry.runId) ? <button type="button" className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35" onClick={() => navigate('/records')}>{entry.runId}</button> : <span title="對應封存已清除">{entry.runId}</span>}
                    </td>
                    <td className="py-2.5">{entry.runner}{entry.models.length ? ` · ${entry.models.join(', ')}` : ''}</td>
                    <td className="py-2.5 text-on-surface-variant">{entry.status}</td>
                    <td className="py-2.5 text-right font-[family-name:var(--font-mono)] tabular-nums">{formatTokens(entry.tokens.total)}</td>
                    <td className="py-2.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-on-surface-variant">{entry.costUsd === undefined ? '—' : formatUsd(entry.costUsd)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </>}
      </div>
    </div>
  )
}
