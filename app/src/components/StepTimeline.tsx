import type { ExecutionStep, ModelSource } from '../agent/types'
import { Icon } from './Icon'
import { PixelLoader } from './primitives/PixelLoader'
import { ShimmerLabel } from './primitives/ShimmerLabel'
import { SpinnerRing } from './primitives/SpinnerRing'

function modelSourceLabel(src?: ModelSource): string {
  switch (src) {
    case 'role':
      return '角色模型'
    case 'fallback':
      return '全域退回'
    case 'primary':
      return '全域主代理'
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
    <div className="agent-step-timeline flex flex-col gap-0" aria-label="執行步驟">
      {steps.map((step, i) => {
        const isDone = step.status === 'COMPLETED'
        const isActive = step.status === 'IN_PROGRESS'
        const isFailed = step.status === 'FAILED'
        const isLast = i === steps.length - 1
        const srcLabel = modelSourceLabel(step.modelSource)

        return (
          <div
            key={step.step}
            className="agent-step-row flex gap-3"
            style={{ animation: `fade-up 400ms cubic-bezier(0.23,1,0.32,1) ${i * 60}ms both` }}
          >
            <div className="flex flex-col items-center">
              {/* docs/ui「Task Rows」: 待辦與進行中共用同一個圓環、序號固定在圓心，
                  只有結束時才換成實心徽章，所以標記不會在狀態切換時跳位。 */}
              <div className="agent-step-marker flex shrink-0 items-center justify-center">
                {isDone || isFailed ? (
                  <span
                    className={`flex size-[22px] items-center justify-center rounded-full ${
                      isFailed ? 'bg-error text-on-error' : 'bg-primary-container text-on-primary-container'
                    }`}
                    style={{ animation: 'pop-in 300ms cubic-bezier(0.23,1,0.32,1) both' }}
                  >
                    <Icon name={isFailed ? 'close' : 'check'} size={14} filled={isDone} />
                  </span>
                ) : (
                  <SpinnerRing active={isActive} tone={isActive ? 'active' : 'idle'}>
                    {step.step}
                  </SpinnerRing>
                )}
              </div>
              {!isLast && (
                <div
                  className={`agent-step-connector w-px flex-1 min-h-5 my-1 ${
                    isDone ? 'bg-primary/40' : 'bg-outline-variant/40'
                  }`}
                />
              )}
            </div>
            <div className={`agent-step-content pb-4 flex-1 ${isActive ? 'opacity-100' : isDone ? 'opacity-90' : 'opacity-50'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`font-semibold text-[12px] ${
                    isActive ? 'text-primary' : 'text-on-surface'
                  }`}
                >
                  {step.description}
                </span>
                {step.assignedAgent && (
                  <span className="agent-step-chip">
                    {step.assignedAgent}
                  </span>
                )}
                {isActive && (
                  <span className="agent-step-active-chip">
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
                  className={`agent-step-model mt-1 text-[10px] font-[family-name:var(--font-mono)] ${
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
                <p className="agent-step-result text-[12px] text-on-surface-variant mt-1 whitespace-pre-wrap break-words line-clamp-6">
                  {step.result}
                </p>
              )}
              {isActive && (
                <p className="mt-1 flex items-center gap-2 text-[12px] text-primary/70">
                  <PixelLoader />
                  <ShimmerLabel active>處理中…</ShimmerLabel>
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
