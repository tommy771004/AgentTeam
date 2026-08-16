import { useEffect, useRef, useState } from 'react'
import {
  RETRY_LIMITS,
  buildRetryOverrides,
  buildRetryRunFields,
  clampRetryParams,
  retryEligibility,
  type RetryEvidence,
  type RetryParams,
} from '../agent/retryOverrides'
import type { LoopType } from '../agent/types'
import { Icon } from './Icon'

/**
 * Composer new-task flow（ticket 07）— 對話內的調整參數重跑。
 *
 * 只在任務失敗／中止後出現，和「繼續回合／繼續 Goal」同區。重跑走既有生命週期，
 * 拿到新的 runId、來源記為 retry，結果回到同一個對話。
 */
export function RetryWithOverrides({
  threadId,
  objective,
  loopType,
  evidence,
  defaults,
  onRetried,
}: {
  threadId: string
  objective: string
  loopType: LoopType | undefined
  evidence: RetryEvidence
  defaults: RetryParams
  onRetried?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [params, setParams] = useState<RetryParams>(defaults)
  const [running, setRunning] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const eligibility = retryEligibility(loopType, evidence)

  const retry = async () => {
    if (running || !eligibility.canRetry) return
    setRunning(true)
    try {
      const clamped = clampRetryParams(params, defaults)
      const { runTask } = await import('../agent/taskRunCoordinator')
      await runTask({
        ...buildRetryRunFields(loopType, evidence),
        objective,
        reuseThreadId: threadId,
        overrides: buildRetryOverrides(clamped, evidence),
      })
      setOpen(false)
      onRetried?.()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="relative" ref={rootRef} data-testid="retry-with-overrides">
      <button
        type="button"
        aria-expanded={open}
        disabled={running}
        onClick={() => setOpen((value) => !value)}
        className="agent-result-action w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[12px] font-medium text-ink">
            {running ? '正在重跑…' : '調整參數重跑'}
          </span>
          <span className="mt-0.5 block text-[10px] text-ink-3">
            改迭代次數、信心門檻或逾時後再跑一次
          </span>
        </span>
        <Icon
          aria-hidden
          name={running ? 'progress_activity' : 'tune'}
          size={15}
          className={`shrink-0 text-ink-3 ${running ? 'animate-spin' : ''}`}
        />
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-[100] mb-2 w-[min(320px,calc(100vw-2rem))] space-y-2.5 rounded-card border border-line bg-surface p-3 shadow-raised">
          <NumberField
            label="最大迭代次數"
            hint={`${RETRY_LIMITS.maxIterations.min}–${RETRY_LIMITS.maxIterations.max}`}
            value={params.maxIterations}
            min={RETRY_LIMITS.maxIterations.min}
            max={RETRY_LIMITS.maxIterations.max}
            step={1}
            onChange={(maxIterations) => setParams((current) => ({ ...current, maxIterations }))}
          />
          <NumberField
            label="最低信心"
            hint="0.1–1.0"
            value={params.minConfidence}
            min={RETRY_LIMITS.minConfidence.min}
            max={RETRY_LIMITS.minConfidence.max}
            step={0.05}
            onChange={(minConfidence) => setParams((current) => ({ ...current, minConfidence }))}
          />
          <NumberField
            label="逾時（秒）"
            hint={`${RETRY_LIMITS.timeoutMs.min / 1000}–${RETRY_LIMITS.timeoutMs.max / 1000}`}
            value={Math.round(params.timeoutMs / 1000)}
            min={RETRY_LIMITS.timeoutMs.min / 1000}
            max={RETRY_LIMITS.timeoutMs.max / 1000}
            step={5}
            onChange={(seconds) =>
              setParams((current) => ({ ...current, timeoutMs: seconds * 1000 }))
            }
          />

          {eligibility.canRetry ? null : (
            <p className="text-[10px] leading-relaxed text-orange">{eligibility.reason}</p>
          )}

          <div className="flex justify-end gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-control px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 transition-colors hover:bg-hover"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!eligibility.canRetry || running}
              onClick={() => void retry()}
              className="rounded-control bg-ink px-2.5 py-1.5 text-[11px] font-semibold text-canvas shadow-btn transition-[filter] hover:brightness-110 disabled:opacity-40"
            >
              重跑
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-ink-2">{label}</span>
        <span className="block text-[10px] text-ink-3">{hint}</span>
      </span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
        className="w-20 shrink-0 rounded-control border border-line bg-inset px-2 py-1 text-right text-[12px] text-ink outline-none focus:border-line-strong"
      />
    </label>
  )
}
