import type { WorkingStateGoalView, WorkingStateProjection } from '../agent/workingStateProjection.ts'

const STATUS_COPY: Record<WorkingStateGoalView['status'], string> = {
  pending: '等待中',
  done: '已驗證',
  blocked: '受阻',
}

const STATUS_MARK: Record<WorkingStateGoalView['status'], string> = {
  pending: '○',
  done: '✓',
  blocked: '!',
}

function evidenceLabel(value: string): string {
  return value.length <= 28 ? value : `${value.slice(0, 12)}…${value.slice(-10)}`
}

export function WorkingStateView({ projection }: { projection: WorkingStateProjection }) {
  if (projection.verification === 'unavailable' || projection.tombstoned) {
    return (
      <div
        className="working-state-unavailable px-1 py-2 text-[12px] leading-relaxed text-ink-2"
        role="note"
        data-working-state-verification="unavailable"
      >
        {projection.tombstoned
          ? '這份 Working State 已由 Host 封存，不會從晚到的 renderer 事件恢復。'
          : '此環境沒有可讀的 Checker-backed Working State；進度未驗證。'}
      </div>
    )
  }

  const verified = projection.verification === 'verified'
  return (
    <section
      className="working-state-view bg-surface-container-low px-3.5 py-3 text-ink-2"
      aria-label="Working State"
      data-working-state-verification={projection.verification}
      data-working-state-revision={projection.revision}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h4 className="text-[12px] font-semibold text-ink">工作狀態</h4>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">
            {verified ? '由 Pi Core Host Checker 驗證' : '相容模式投影，未經目前 Host 驗證'}
          </p>
        </div>
        <span className="text-[12px] tabular-nums text-ink-2">Revision {projection.revision}</span>
      </header>

      <div className="mt-3 space-y-3">
        {projection.goals.map((goal, index) => (
          <article key={goal.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
            <div className="text-[12px] font-semibold text-ink-2" aria-label={STATUS_COPY[goal.status]}>
              <span
                aria-hidden="true"
                className={`mr-1.5 ${goal.status === 'blocked' ? 'text-orange' : goal.status === 'done' ? 'text-green' : 'text-ink-2'}`}
              >
                {STATUS_MARK[goal.status]}
              </span>
              {STATUS_COPY[goal.status]}
            </div>
            <div className="min-w-0">
              <p className="text-[12px] leading-relaxed text-ink-2">
                <span className="mr-1.5 tabular-nums text-ink-2">{index + 1}.</span>
                {goal.description}
              </p>
              {goal.blocker ? (
                <p className="mt-1 text-[12px] font-medium leading-relaxed text-ink-2">阻擋原因：{goal.blocker}</p>
              ) : null}
              {goal.evidence.length > 0 ? (
                <div className="mt-1.5 space-y-0.5 text-[12px] leading-relaxed text-ink-2" aria-label="驗證證據">
                  {goal.evidence.map((reference) => (
                    <div key={`${reference.seq}:${reference.evidenceId}`} className="flex min-w-0 gap-2">
                      <span className="shrink-0 tabular-nums">seq {reference.seq}</span>
                      <span className="min-w-0 truncate font-[family-name:var(--font-mono)]">
                        {reference.tool} · {evidenceLabel(reference.callId)}
                      </span>
                    </div>
                  ))}
                  {goal.hiddenEvidenceCount > 0 ? <div>另有 {goal.hiddenEvidenceCount} 筆較早證據</div> : null}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
