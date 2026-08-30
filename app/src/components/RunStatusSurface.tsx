import { ElapsedTime } from './primitives/ElapsedTime.tsx'
import type { RunSecondarySurface, RunStatusSurfaceProjection } from '../agent/runStatusSurface.ts'

const MILESTONE_MARK = {
  pending: '○',
  current: '◉',
  done: '✓',
  blocked: '!',
} as const

const MILESTONE_COPY = {
  pending: '等待中',
  current: '進行中',
  done: '已完成',
  blocked: '受阻',
} as const

function formatUpdateTime(value: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
}

function SecondarySurface({ surface }: { surface: RunSecondarySurface }) {
  if (surface.kind === 'progress') {
    return (
      <section className="border-b border-line px-4 py-4" aria-labelledby="run-secondary-title">
        <h3 id="run-secondary-title" className="text-[12px] font-semibold text-ink">{surface.title}</h3>
        <ol className="mt-3 space-y-2.5" aria-label="任務里程碑">
          {surface.milestones.map((milestone) => (
            <li key={milestone.id} className="flex min-w-0 items-start gap-2.5">
              <span aria-hidden="true" className={`mt-px shrink-0 font-semibold ${milestone.status === 'done' ? 'text-green' : milestone.status === 'blocked' ? 'text-orange' : milestone.status === 'current' ? 'text-accent-ink' : 'text-ink-3'}`}>
                {MILESTONE_MARK[milestone.status]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-relaxed text-ink-2">
                  <span className="sr-only">{MILESTONE_COPY[milestone.status]}：</span>{milestone.description}
                </p>
                {milestone.blocker ? <p className="mt-1 text-[11px] leading-relaxed text-orange">阻擋原因：{milestone.blocker}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    )
  }
  if (surface.kind === 'activity') {
    return (
      <section className="border-b border-line px-4 py-4" aria-labelledby="run-secondary-title">
        <h3 id="run-secondary-title" className="text-[12px] font-semibold text-ink">{surface.title}</h3>
        <ol className="mt-3 space-y-2 text-[12px] leading-relaxed text-ink-2" aria-label="最近活動">
          {surface.items.map((item, index) => <li key={`${index}:${item}`} className="flex gap-2"><span aria-hidden="true" className="text-ink-3">·</span><span>{item}</span></li>)}
        </ol>
      </section>
    )
  }
  if (surface.kind === 'attention') {
    return (
      <section className="border-b border-line px-4 py-4" aria-labelledby="run-secondary-title" data-attention-kind={surface.attentionKind}>
        <h3 id="run-secondary-title" className="text-[12px] font-semibold text-orange">{surface.title}</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{surface.action}</p>
      </section>
    )
  }
  return (
    <section className="border-b border-line px-4 py-4" aria-labelledby="run-secondary-title" data-terminal-outcome={surface.outcome}>
      <h3 id="run-secondary-title" className="text-[12px] font-semibold text-ink">{surface.title}</h3>
      <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-ink-2">
        {surface.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  )
}

export function RunStatusSurface({ projection, startedAt }: { projection: RunStatusSurfaceProjection; startedAt: number }) {
  return (
    <>
      <section className="border-b border-line px-4 py-4" aria-labelledby="run-status-title">
        <h2 id="run-status-title" className="text-[10px] font-semibold text-ink-3">執行狀態</h2>
        <p className={`mt-1 text-[13px] font-medium ${projection.live ? 'text-accent-ink' : 'text-ink'}`} role="status" aria-live="polite" aria-atomic="true">
          {projection.label}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-3">
          {projection.live && startedAt > 0 ? <span className="font-[family-name:var(--font-mono)] tabular-nums"><ElapsedTime startedAt={startedAt} /></span> : null}
          {projection.updatedAt ? <span className="font-[family-name:var(--font-mono)] tabular-nums">最後更新 {formatUpdateTime(projection.updatedAt)}</span> : null}
        </div>
      </section>
      {projection.secondary ? <SecondarySurface surface={projection.secondary} /> : null}
    </>
  )
}
