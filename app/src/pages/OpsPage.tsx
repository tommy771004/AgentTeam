import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { OutboundRunView } from '../components/OutboundRunView'
import { useAgentStore } from '../store/agentStore'
import { useScheduleStore } from '../store/scheduleStore'
import { buildOpsSnapshot } from '../agent/opsConsole'
import {
  listJournalEntries,
  listRecoveryReports,
} from '../agent/runJournal.ts'
import {
  hydrateRunQueue,
  listQueueDedupeEvents,
  listQueuedRuns,
  subscribeRunQueue,
} from '../agent/runQueue'

const tabs = [
  { id: 'overview', label: '總覽' },
  { id: 'automation', label: '排程與事件' },
  { id: 'execution', label: '執行與佇列' },
]

export function OpsPage() {
  const [params, setParams] = useSearchParams()
  const tab = tabs.some((item) => item.id === params.get('tab')) ? params.get('tab')! : 'overview'
  const [queueTick, setQueueTick] = useState(0)
  const jobs = useScheduleStore((state) => state.jobs)
  const events = useScheduleStore((state) => state.events)
  const activeRunIds = useAgentStore((state) => state.activeRunIds)
  const runStates = useAgentStore((state) => state.runStates)
  const capacity = useAgentStore((state) => state.canStartRun())

  useEffect(() => {
    hydrateRunQueue()
    return subscribeRunQueue(() => setQueueTick((value) => value + 1))
  }, [])

  const snapshot = useMemo(() => {
    void queueTick
    return buildOpsSnapshot({
      jobs,
      events,
      activeRuns: activeRunIds.map((runId) => ({
        runId,
        status: runStates[runId]?.status || 'running',
      })),
      capacity: { active: capacity.active, limit: capacity.limit },
      queuedRuns: listQueuedRuns(),
      dedupeEvents: listQueueDedupeEvents(),
      journal: listJournalEntries(),
      recoveryReports: listRecoveryReports(),
    })
  }, [activeRunIds, capacity.active, capacity.limit, events, jobs, queueTick, runStates])

  const setTab = (id: string) => setParams(id === 'overview' ? {} : { tab: id })
  const showQueue = tab === 'overview' || tab === 'execution'
  const showAutomation = tab === 'overview' || tab === 'automation'

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-primary font-semibold">Ops Console</p>
          <h1 className="font-[family-name:var(--font-sora)] text-3xl font-semibold">執行營運總覽</h1>
          <p className="text-sm text-on-surface-variant mt-1">排程、事件、佇列、容量與 recovery 的同一個投影面。</p>
        </div>
        <div className="flex gap-1 p-1 rounded-lg bg-surface-container-high">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-2 rounded-md text-xs font-semibold ${tab === item.id ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Metric icon="play_circle" label="執行中" value={String(snapshot.capacity.active)} detail={`上限 ${snapshot.capacity.limit}`} />
        <Metric icon="hourglass_top" label="剩餘容量" value={String(snapshot.capacity.remaining)} detail="per-app cap" />
        <Metric icon="queue" label="待跑佇列" value={String(snapshot.queue.length)} detail="FIFO / capacity" />
        <Metric icon="filter_alt" label="去重略過" value={String(snapshot.deduplicated.length)} detail="本機保留摘要" />
        <Metric icon="restart_alt" label="Recovery" value={String(snapshot.recoveredRuns.length)} detail="未確定 run" />
      </section>

      {showQueue && (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Panel title="執行佇列" icon="queue">
            {snapshot.queue.length === 0 ? <Empty text="目前沒有因容量限制等待的工作。" /> : (
              <div className="flex flex-col divide-y divide-line/50">
                {snapshot.queue.map((item) => (
                  <div key={item.id} className="py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm truncate">#{item.position} · {item.objective}</p>
                      <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-mono)]">{item.id} · {item.sourceKind || 'unknown'} · {item.runner || 'builtin'}</p>
                    </div>
                    <span className="shrink-0 text-[10px] px-2 py-1 rounded border border-warning/30 text-warning">{item.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="去重與 recovery" icon="history">
            {snapshot.deduplicated.length === 0 && snapshot.recoveredRuns.length === 0 ? <Empty text="尚無去重略過或 crash recovery 記錄。" /> : (
              <div className="flex flex-col gap-2">
                {snapshot.deduplicated.slice(-8).reverse().map((item, index) => (
                  <div key={`${item.at}-${index}`} className="text-xs border-l-2 border-warning pl-3">
                    <p>去重略過：{item.objective}</p>
                    <p className="text-on-surface-variant">{item.at} · {item.sourceKind || 'unknown'} · duplicate</p>
                  </div>
                ))}
                {snapshot.recoveredRuns.slice(-8).reverse().map((item, index) => (
                  <div key={`${item.reportId}-${item.id}-${index}`} className="text-xs border-l-2 border-error pl-3">
                    <p>Recovery：{item.id} · {item.action}</p>
                    <p className="text-on-surface-variant">{item.detail || 'run marked interrupted'}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>
      )}

      <OutboundRunView runId={snapshot.activeRuns[0]?.runId} />

      {showAutomation && (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Panel title={`排程（${snapshot.schedules.length}）`} icon="schedule">
            {snapshot.schedules.length === 0 ? <Empty text="尚未建立 ScheduledJob。" /> : snapshot.schedules.slice(0, 10).map((job) => (
              <div key={job.id} className="py-2 border-b border-line/40 last:border-0 flex items-center justify-between gap-3">
                <div><p className="text-sm">{job.name}</p><p className="text-xs text-on-surface-variant">{job.objective}</p></div>
                <span className="text-[11px] text-on-surface-variant">{job.lastStatus || (job.enabled ? 'ready' : 'off')}</span>
              </div>
            ))}
          </Panel>
          <Panel title={`事件 matcher（${snapshot.events.length}）`} icon="bolt">
            {snapshot.events.length === 0 ? <Empty text="尚未建立 Proactive event。" /> : snapshot.events.slice(0, 10).map((event) => (
              <div key={event.id} className="py-2 border-b border-line/40 last:border-0 flex items-center justify-between gap-3">
                <div><p className="text-sm">{event.name}</p><p className="text-xs text-on-surface-variant">{event.source} · {event.objective}</p></div>
                <span className={`text-[11px] ${event.enabled ? 'text-success' : 'text-on-surface-variant'}`}>{event.enabled ? 'enabled' : 'off'}</span>
              </div>
            ))}
          </Panel>
        </section>
      )}

      <footer className="text-xs text-on-surface-variant flex items-center gap-3">
        <span>最後投影：{snapshot.generatedAt}</span>
        <Link className="text-primary hover:underline" to="/records">查看封存與日誌</Link>
      </footer>
    </div>
  )
}

function Metric({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return <div className="glass-panel rounded-xl p-4"><div className="flex items-center gap-2 text-on-surface-variant"><Icon name={icon} size={16} /><span className="text-[10px] uppercase tracking-widest">{label}</span></div><p className="text-2xl font-semibold mt-2">{value}</p><p className="text-[11px] text-on-surface-variant">{detail}</p></div>
}

function Panel({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return <section className="glass-panel rounded-xl p-5"><h2 className="font-semibold flex items-center gap-2 mb-3"><Icon name={icon} size={18} className="text-primary" />{title}</h2>{children}</section>
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-on-surface-variant py-5">{text}</p>
}
