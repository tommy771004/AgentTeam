import type { ExecutionStep, ModelSource } from '../agent/types'
import { Icon } from './Icon'

function modelSourceLabel(src?: ModelSource): string {
  switch (src) {
    case 'role':
      return '角色模型'
    case 'fallback':
      return '全域退回'
    case 'cli':
      return 'CLI'
    case 'sim':
      return '模擬'
    case 'none':
      return '未設定'
    default:
      return ''
  }
}

export function StepTimeline({ steps }: { steps: ExecutionStep[] }) {
  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, i) => {
        const isDone = step.status === 'COMPLETED'
        const isActive = step.status === 'IN_PROGRESS'
        const isFailed = step.status === 'FAILED'
        const isLast = i === steps.length - 1
        const srcLabel = modelSourceLabel(step.modelSource)

        return (
          <div key={step.step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center border shrink-0 ${
                  isDone
                    ? 'border-primary bg-primary/10 text-primary'
                    : isActive
                      ? 'border-primary text-primary'
                      : isFailed
                        ? 'border-error text-error'
                        : 'border-outline-variant text-outline'
                }`}
              >
                {isDone ? (
                  <Icon name="check" size={18} filled />
                ) : isActive ? (
                  <Icon name="progress_activity" size={18} className="animate-spin" />
                ) : isFailed ? (
                  <Icon name="close" size={18} />
                ) : (
                  <Icon name="radio_button_unchecked" size={18} />
                )}
              </div>
              {!isLast && (
                <div
                  className={`w-px flex-1 min-h-6 my-1 ${
                    isDone ? 'bg-primary/40' : 'bg-outline-variant/40'
                  }`}
                />
              )}
            </div>
            <div className={`pb-5 flex-1 ${isActive ? 'opacity-100' : isDone ? 'opacity-90' : 'opacity-50'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`font-semibold text-xs tracking-wider uppercase ${
                    isActive ? 'text-primary' : 'text-on-surface'
                  }`}
                >
                  {step.description}
                </span>
                {step.assignedAgent && (
                  <span className="text-[10px] text-on-surface-variant border border-white/10 px-1.5 py-0.5 rounded">
                    {step.assignedAgent}
                  </span>
                )}
                {isActive && (
                  <span className="bg-primary/20 text-primary text-[10px] font-semibold px-2 py-0.5 rounded tracking-wider">
                    進行中
                  </span>
                )}
                {step.durationMs != null && isDone && (
                  <span className="text-outline text-xs font-[family-name:var(--font-mono)] ml-auto">
                    {(step.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {(step.modelUsed || srcLabel) && (
                <p
                  className={`mt-1 text-[11px] font-[family-name:var(--font-mono)] ${
                    step.modelSource === 'fallback'
                      ? 'text-amber-300/90'
                      : step.modelSource === 'role' || step.modelSource === 'cli'
                        ? 'text-primary/90'
                        : 'text-outline'
                  }`}
                  title={
                    step.modelSource === 'fallback'
                      ? '此角色未填 roleModels，已退回全域／thread model'
                      : undefined
                  }
                >
                  model: {step.modelUsed || '—'}
                  {srcLabel ? ` · ${srcLabel}` : ''}
                  {step.modelSource === 'fallback' ? ' ⚠' : ''}
                </p>
              )}
              {step.result && (
                <p className="text-sm text-on-surface-variant mt-1 whitespace-pre-wrap break-words line-clamp-6">
                  {step.result}
                </p>
              )}
              {isActive && (
                <p className="text-sm text-primary/70 mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  處理中…
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
