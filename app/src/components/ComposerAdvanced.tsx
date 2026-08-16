import { useMemo, type ReactNode } from 'react'
import { LOOP_CHOICES, allowedDepthsFor } from '../agent/composerLayering'
import { SPEED_MODES, type SpeedMode, type ThinkingDepth } from '../agent/thinking'
import type { AgentMode, CliProviderConfig, LoopType } from '../agent/types'
import type { ThreadRunner } from '../store/threadStore'
import { useComposerUiStore } from '../store/composerUiStore'
import { Icon } from './Icon'

export type RunnerOption = {
  id: ThreadRunner
  label: string
  ready: boolean
  blurb: string
}

/**
 * Composer new-task flow（ticket 03）— 「進階」折疊區。
 *
 * 基礎列對大多數人就是一個輸入框；這裡收的是開發者級決策（Loop Pattern、
 * 執行引擎、推理程度與速度、Build/Plan）。全部選項與預設值都與分層前相同，
 * 只是不再擋在第一次送出的路上。展開狀態是 per-app 偏好，換對話不會重置。
 *
 * 收合時整塊不渲染，但觸發器本身永遠可見可聚焦——沒有任何內容是靠動畫才出現的。
 */
export function ComposerAdvanced({
  disabled,
  loopType,
  agentMode,
  runner,
  runners,
  depth,
  speed,
  model,
  globalModel,
  cliProviders,
  onLoopChange,
  onCreateAutomation,
  onAgentModeChange,
  onRunnerChange,
  onDepthChange,
  onSpeedChange,
}: {
  disabled?: boolean
  /** null = 自動分類 */
  loopType: LoopType | null
  agentMode: AgentMode
  runner: ThreadRunner
  runners: RunnerOption[]
  depth: ThinkingDepth
  speed: SpeedMode
  model: string
  globalModel: string
  cliProviders?: CliProviderConfig[]
  onLoopChange: (type: LoopType | null) => void
  /** 定時／事件不是釘選，而是開建立規則的表單 */
  onCreateAutomation: (kind: 'schedule' | 'event') => void
  onAgentModeChange: (mode: AgentMode) => void
  onRunnerChange: (runner: ThreadRunner) => void
  onDepthChange: (depth: ThinkingDepth) => void
  onSpeedChange: (speed: SpeedMode) => void
}) {
  const open = useComposerUiStore((state) => state.advancedOpen)
  const toggle = useComposerUiStore((state) => state.toggleAdvanced)

  const depths = useMemo(
    () => allowedDepthsFor(cliProviders, model, globalModel),
    [cliProviders, model, globalModel],
  )

  const activeLoop = LOOP_CHOICES.find(
    (choice) => !choice.createsAutomation && choice.type === loopType,
  )
  const activeDepth = depths.find((item) => item.id === depth) || depths[0]
  const summary = [
    activeLoop?.label || '自動',
    runners.find((item) => item.id === runner)?.label || '內建',
    activeDepth?.label,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="w-full" data-testid="composer-advanced">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="composer-advanced-panel"
        className="flex items-center gap-1.5 rounded-control px-1.5 py-1 text-[11px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-line-strong"
      >
        <Icon
          aria-hidden
          name="chevron_right"
          size={14}
          className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="font-medium">進階</span>
        {!open ? <span className="truncate text-ink-3/80">{summary}</span> : null}
      </button>

      {open ? (
        <div
          id="composer-advanced-panel"
          className="mt-1.5 space-y-3 rounded-card border border-line bg-surface-container-low p-3"
        >
          <Group label="工作方式">
            <div className="grid grid-cols-2 gap-1">
              {(['build', 'plan'] as const).map((mode) => (
                <Choice
                  key={mode}
                  active={agentMode === mode}
                  disabled={disabled}
                  title={mode === 'build' ? '直接動手做' : '先給計畫，不動檔案'}
                  onClick={() => onAgentModeChange(mode)}
                >
                  <Icon
                    aria-hidden
                    name={mode === 'build' ? 'construction' : 'checklist'}
                    size={15}
                    className="shrink-0"
                  />
                  {mode === 'build' ? 'Build' : '規劃模式'}
                </Choice>
              ))}
            </div>
          </Group>

          <Group label="Loop Pattern">
            <div className="grid grid-cols-5 gap-1">
              {LOOP_CHOICES.map((choice) => (
                <Choice
                  key={choice.type ?? 'auto'}
                  active={!choice.createsAutomation && loopType === choice.type}
                  disabled={disabled}
                  title={choice.hint}
                  stacked
                  onClick={() =>
                    choice.createsAutomation
                      ? onCreateAutomation(choice.createsAutomation)
                      : onLoopChange(choice.type)
                  }
                >
                  <Icon aria-hidden name={choice.icon} size={16} className="shrink-0" />
                  {choice.label}
                </Choice>
              ))}
            </div>
          </Group>

          <Group label="執行引擎">
            <div className="flex flex-wrap gap-1">
              {runners.map((option) => (
                <Choice
                  key={option.id}
                  active={runner === option.id}
                  disabled={disabled || (!option.ready && option.id !== 'builtin')}
                  title={option.ready ? option.blurb : `${option.label} 尚未授權`}
                  onClick={() => onRunnerChange(option.id)}
                >
                  {option.label}
                </Choice>
              ))}
            </div>
          </Group>

          <Group label="推理程度">
            <div className="flex flex-wrap gap-1">
              {depths.map((item) => (
                <Choice
                  key={item.id}
                  active={depth === item.id}
                  disabled={disabled}
                  title={item.description}
                  onClick={() => onDepthChange(item.id)}
                >
                  {item.label}
                </Choice>
              ))}
            </div>
          </Group>

          <Group label="速度">
            <div className="flex flex-wrap gap-1">
              {SPEED_MODES.map((item) => (
                <Choice
                  key={item.id}
                  active={speed === item.id}
                  disabled={disabled}
                  title={item.description}
                  onClick={() => onSpeedChange(item.id)}
                >
                  {item.label}
                </Choice>
              ))}
            </div>
          </Group>
        </div>
      ) : null}
    </div>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 text-[11px] font-semibold text-ink-3">{label}</p>
      {children}
    </section>
  )
}

function Choice({
  active,
  disabled,
  title,
  stacked,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  title: string
  /** 圖示在文字上方（Loop 格） */
  stacked?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-control px-2.5 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-line-strong disabled:cursor-not-allowed disabled:opacity-35 ${
        stacked ? 'flex-col gap-1 px-1 py-2 text-[10px]' : ''
      } ${active ? 'bg-accent-tint text-accent-ink' : 'bg-inset text-ink-2 hover:bg-hover-2'}`}
    >
      {children}
    </button>
  )
}
