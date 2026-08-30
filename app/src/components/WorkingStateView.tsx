import type { WorkingStateProjection } from '../agent/workingStateProjection.ts'

function evidenceLabel(value: string): string {
  return value.length <= 28 ? value : `${value.slice(0, 12)}…${value.slice(-10)}`
}

/** Archive/replay presentation of the same Host milestone ordering. */
export function WorkingStateView({ projection }: { projection: WorkingStateProjection }) {
  if (projection.verification !== 'verified' || projection.tombstoned || projection.goals.length === 0) return null
  return (
    <section className="working-state-view bg-surface-container-low px-3.5 py-3 text-ink-2" aria-label="任務進度">
      <h3 className="text-[12px] font-semibold text-ink">任務進度</h3>
      <ol className="mt-2.5 space-y-2">
        {projection.goals.map((goal) => (
          <li key={goal.id} className="flex min-w-0 items-start gap-2.5 text-[12px] leading-relaxed">
            <span aria-hidden="true" className={goal.status === 'done' ? 'text-green' : goal.status === 'blocked' ? 'text-orange' : 'text-ink-3'}>
              {goal.status === 'done' ? '✓' : goal.status === 'blocked' ? '!' : '○'}
            </span>
            <span className="min-w-0 flex-1">
              {goal.description}
              {goal.blocker ? <span className="mt-1 block text-[11px] text-orange">阻擋原因：{goal.blocker}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function WorkingStateDiagnostics({ projection }: { projection: WorkingStateProjection }) {
  return (
    <section
      className="working-state-diagnostics text-ink-2"
      aria-label="Working State 診斷"
      data-working-state-verification={projection.verification}
      data-working-state-revision={projection.revision}
    >
      <p className="text-[11px] font-medium text-ink-2">Working State</p>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
        {projection.verification === 'verified' ? 'Host 已驗證' : projection.tombstoned ? 'Host 已封存' : '不可用或未驗證'}
        {projection.revision !== undefined ? ` · rev ${projection.revision}` : ''}
        {` · ${projection.goals.length} 個目標`}
      </p>
      {projection.constraints.length > 0 ? (
        <details className="working-state-constraints mt-2">
          <summary className="cursor-pointer text-[10px] text-ink-3">執行限制 {projection.constraints.length} 項</summary>
          <ul className="mt-1 space-y-1 pl-4 text-[10px] leading-relaxed text-ink-3">
            {projection.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}
          </ul>
        </details>
      ) : null}
      {projection.goals.some((goal) => goal.evidence.length > 0) ? (
        <details className="working-state-evidence mt-2">
          <summary className="cursor-pointer text-[10px] text-ink-3">驗證證據</summary>
          <div className="mt-1 space-y-1 text-[10px] leading-relaxed text-ink-3">
            {projection.goals.flatMap((goal) => goal.evidence.map((reference) => (
              <div key={`${goal.id}:${reference.seq}:${reference.evidenceId}`} className="flex min-w-0 gap-2">
                <span className="shrink-0 tabular-nums">seq {reference.seq}</span>
                <span className="min-w-0 truncate font-[family-name:var(--font-mono)]">{reference.tool} · {evidenceLabel(reference.callId)}</span>
              </div>
            )))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
