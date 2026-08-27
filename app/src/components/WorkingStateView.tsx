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
  const completedCount = projection.goals.filter((goal) => goal.status === 'done').length
  const blockedCount = projection.goals.filter((goal) => goal.status === 'blocked').length
  const summary = projection.goals.length > 0
    ? `${completedCount}/${projection.goals.length} 已驗證${blockedCount > 0 ? `，${blockedCount} 項受阻` : ''}`
    : '尚無目標'

  return (
    <section
      className="working-state-view bg-surface-container-low text-ink-2"
      aria-label="Working State"
      aria-live="polite"
      data-working-state-verification={projection.verification}
      data-working-state-revision={projection.revision}
    >
      <details open>
        <summary className="working-state-summary flex cursor-pointer list-none items-center justify-between gap-4 px-3.5 py-3 text-left">
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-ink">工作狀態</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-2">{summary}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink-3">
            <span>{verified ? 'Host 已驗證' : '相容模式'}</span>
            {projection.revision !== undefined ? (
              <span className="font-[family-name:var(--font-mono)] tabular-nums">rev {projection.revision}</span>
            ) : null}
            <span className="working-state-chevron" aria-hidden="true">⌄</span>
          </span>
        </summary>

        <div className="working-state-content px-3.5 pb-3">
          {projection.objective ? (
            <p className="mb-2.5 text-[12px] font-medium leading-relaxed text-ink">{projection.objective}</p>
          ) : null}

          {projection.goals.length > 0 ? (
            <ol className="space-y-2" aria-label="工作目標">
              {projection.goals.map((goal) => (
                <li key={goal.id} className="working-state-goal flex min-w-0 items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`working-state-mark mt-px shrink-0 font-semibold ${
                      goal.status === 'blocked' ? 'text-orange' : goal.status === 'done' ? 'text-green' : 'text-ink-3'
                    }`}
                  >
                    {STATUS_MARK[goal.status]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-relaxed text-ink-2">
                      <span className="sr-only">{STATUS_COPY[goal.status]}：</span>
                      {goal.description}
                    </p>
                    {goal.blocker ? (
                      <p className="mt-1 text-[12px] font-medium leading-relaxed text-orange">阻擋原因：{goal.blocker}</p>
                    ) : null}
                    {goal.evidence.length > 0 ? (
                      <details className="working-state-evidence mt-1">
                        <summary className="cursor-pointer text-[11px] text-ink-3">
                          驗證證據 {goal.evidence.length + goal.hiddenEvidenceCount} 筆
                        </summary>
                        <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-ink-3" aria-label="驗證證據">
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
                      </details>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12px] leading-relaxed text-ink-3">Host 尚未建立可驗證的工作目標。</p>
          )}

          {projection.constraints.length > 0 ? (
            <details className="working-state-constraints mt-2.5">
              <summary className="cursor-pointer text-[11px] text-ink-3">執行限制 {projection.constraints.length} 項</summary>
              <ul className="mt-1 space-y-1 pl-4 text-[11px] leading-relaxed text-ink-3">
                {projection.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      </details>
    </section>
  )
}
