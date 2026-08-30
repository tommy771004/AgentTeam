import { ElapsedTime } from './primitives/ElapsedTime.tsx'
import type { RunSecondarySurface, RunStatusSurfaceProjection } from '../agent/runStatusSurface.ts'
import { RunTaskRow } from './RunTaskRow.tsx'

function formatUpdateTime(value: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
}

function SecondarySurface({ surface, live }: { surface: RunSecondarySurface; live: boolean }) {
  if (surface.kind === 'progress') {
    return (
      <section className="border-b border-line px-4 py-4" aria-labelledby="run-secondary-title">
        <h3 id="run-secondary-title" className="text-[12px] font-semibold text-ink">{surface.title}</h3>
        <ol className="mt-3 space-y-2" aria-label="任務里程碑">
          {surface.milestones.map((milestone, index) => (
            <RunTaskRow
              key={milestone.id}
              text={milestone.description}
              status={milestone.status}
              index={index}
              live={live}
              detail={milestone.blocker}
              amount={milestone.meta}
              details={milestone.details}
            />
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
      {projection.secondary ? <SecondarySurface surface={projection.secondary} live={projection.live} /> : null}
    </>
  )
}
