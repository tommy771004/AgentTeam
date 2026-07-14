/**
 * Compact global run-queue strip for 新任務 / Automation.
 * Shared FIFO: schedule, webhook, telegram, interactive follow-ups.
 */
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import {
  clearRunQueue,
  isRunQueueDraining,
  listQueuedRuns,
  moveQueuedRun,
  promoteQueuedRun,
  queueLength,
  removeQueuedRun,
  subscribeRunQueue,
  type QueuedExternalRun,
} from '../agent/runQueue'
import { useAgentStore } from '../store/agentStore'
import { useThreadStore } from '../store/threadStore'

export function RunQueueStrip({
  compact = false,
  className = '',
}: {
  compact?: boolean
  className?: string
}) {
  const [queued, setQueued] = useState<QueuedExternalRun[]>(() => listQueuedRuns())
  const [draining, setDraining] = useState(() => isRunQueueDraining())
  const [open, setOpen] = useState(!compact)
  const isRunning = useAgentStore((s) => s.isRunning)
  const runningTitles = useThreadStore((s) =>
    s.runningThreadIds
      .map((id) => s.threads.find((t) => t.id === id)?.title)
      .filter((title): title is string => Boolean(title)),
  )

  useEffect(() => {
    return subscribeRunQueue(() => {
      setQueued(listQueuedRuns())
      setDraining(isRunQueueDraining())
    })
  }, [])

  const n = queueLength()
  if (n === 0 && compact && !isRunning) return null

  return (
    <div
      className={`rounded-xl border border-white/10 bg-surface-container/60 ${className}`}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold text-on-surface-variant">
          <Icon name="pending_actions" size={16} className="text-primary" />
          全域佇列
          <span className="font-[family-name:var(--font-mono)] text-outline font-normal">
            {n}/24
            {draining ? ' · 消化中' : ''}
            {isRunning ? ' · 執行中' : ''}
          </span>
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} className="text-outline" />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
          {isRunning && (
            <p className="text-[11px] text-primary/90 rounded-lg bg-primary/10 px-2 py-1.5">
              目前執行
              {runningTitles.length > 1
                ? `：${runningTitles.length} 個任務（${runningTitles[0].slice(0, 28)} 等）`
                : runningTitles[0]
                  ? `：${runningTitles[0].slice(0, 40)}`
                  : '中'}
              {n > 0 ? ` · 其後 ${n} 則排隊` : ''}
            </p>
          )}
          {n === 0 ? (
            <p className="text-[11px] text-outline">
              {isRunning
                ? '佇列空。新任務會依 follow-up 設定轉向或入列。'
                : '空。忙碌時排程 / TG / Webhook / 對話追問會入列，完成後自動補跑。'}
            </p>
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-[10px] font-semibold text-error hover:underline"
                  onClick={() => {
                    const c = clearRunQueue()
                    setQueued(listQueuedRuns())
                    void window.subagents?.notify?.(
                      'SubAgents AI · 佇列',
                      `已清除 ${c} 筆`,
                    )
                  }}
                >
                  清空全部
                </button>
              </div>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                {queued.map((q, i) => (
                  <li
                    key={q.id}
                    className="flex items-start gap-1.5 rounded-lg border border-white/8 bg-surface/40 px-2 py-1.5"
                  >
                    <span className="text-[10px] text-outline font-[family-name:var(--font-mono)] w-4 shrink-0 pt-0.5">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-on-surface truncate">
                        {q.title || q.objective.slice(0, 40)}
                      </p>
                      <p className="text-[10px] text-outline truncate">
                        {q.sourceLabel || '任務'}
                        {q.reuseThreadId ? ' · 同 thread' : ''}
                        {q.runner && q.runner !== 'builtin' ? ` · ${q.runner}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        title="提高優先（往前）"
                        disabled={i === 0}
                        className="w-6 h-5 rounded text-outline hover:text-primary disabled:opacity-30 flex items-center justify-center"
                        onClick={() => {
                          moveQueuedRun(q.id, -1)
                          setQueued(listQueuedRuns())
                        }}
                      >
                        <Icon name="keyboard_arrow_up" size={14} />
                      </button>
                      <button
                        type="button"
                        title="降低優先"
                        disabled={i >= queued.length - 1}
                        className="w-6 h-5 rounded text-outline hover:text-primary disabled:opacity-30 flex items-center justify-center"
                        onClick={() => {
                          moveQueuedRun(q.id, 1)
                          setQueued(listQueuedRuns())
                        }}
                      >
                        <Icon name="keyboard_arrow_down" size={14} />
                      </button>
                    </div>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        title="插隊到最前"
                        disabled={i === 0}
                        className="text-[9px] px-1.5 py-0.5 rounded border border-primary/25 text-primary disabled:opacity-30"
                        onClick={() => {
                          promoteQueuedRun(q.id)
                          setQueued(listQueuedRuns())
                        }}
                      >
                        置頂
                      </button>
                      <button
                        type="button"
                        title="取消"
                        className="text-[9px] px-1.5 py-0.5 rounded border border-error/25 text-error"
                        onClick={() => {
                          removeQueuedRun(q.id)
                          setQueued(listQueuedRuns())
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
