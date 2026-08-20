import { useEffect, useRef, useState } from 'react'
import type { AgentMode, LoopType } from '../agent/types'
import type { HandoffAvailability } from '../agent/composerRunControls'
import type { ThreadRunner } from '../store/threadStore'
import { Icon } from './Icon'

type RunnerOption = {
  id: ThreadRunner
  label: string
  ready: boolean
  blurb: string
}

type ComposerQuickActionsProps = {
  disabled: boolean
  projectRoot: string | null
  /** null = auto classify */
  loopType: LoopType | null
  agentMode: AgentMode
  runner: ThreadRunner
  runners: RunnerOption[]
  onAttach: () => void
  onPickProject: () => void
  onLoopChange: (type: LoopType | null) => void
  onAgentModeChange: (mode: AgentMode) => void
  onRunnerChange: (runner: ThreadRunner) => void
  onOpenAutomation: (kind: 'schedule' | 'event') => void
  onOpenCapabilities: () => void
  runPanelAvailable: boolean
  onToggleRunPanel: () => void
  onToggleTerminal: () => void
  onCreateThread: () => void
  handoff: HandoffAvailability
  onCreateHandoff: () => void
}

const LOOPS: Array<{ type: LoopType | null; label: string; icon: string }> = [
  { type: null, label: '自動', icon: 'auto_awesome' },
  { type: 'Goal-based', label: '目標', icon: 'track_changes' },
  { type: 'Turn-based', label: '回合', icon: 'forum' },
]

/** Compact Codex-style + menu for optional conversation controls. */
export function ComposerQuickActions({
  disabled,
  projectRoot,
  loopType,
  agentMode,
  runner,
  runners,
  onAttach,
  onPickProject,
  onLoopChange,
  onAgentModeChange,
  onRunnerChange,
  onOpenAutomation,
  onOpenCapabilities,
  runPanelAvailable,
  onToggleRunPanel,
  onToggleTerminal,
  onCreateThread,
  handoff,
  onCreateHandoff,
}: ComposerQuickActionsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const choose = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="新增內容與設定"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex size-7 items-center justify-center rounded-control bg-inset text-ink-2 shadow-hairline transition-colors hover:bg-hover hover:text-ink"
      >
        <Icon name={open ? 'close' : 'add'} size={22} />
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-[110] mb-2 max-h-[min(600px,calc(100vh-8rem))] w-[min(560px,calc(100vw-2rem))] overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-raised custom-scrollbar">
          <MenuLabel>新增</MenuLabel>
          <MenuButton
            icon="attach_file"
            title="檔案和資料夾"
            description="加入圖片、文件或程式檔"
            disabled={disabled}
            onClick={() => choose(onAttach)}
          />
          <MenuButton
            icon="folder_open"
            title={projectRoot ? '更換專案資料夾' : '選擇專案資料夾'}
            description={projectRoot || '讓任務讀寫本機專案'}
            onClick={() => choose(onPickProject)}
          />
          <MenuButton
            icon="add_comment"
            title="新增對話"
            description="保留目前對話，另開新任務"
            onClick={() => choose(onCreateThread)}
          />

          <MenuLabel>交接</MenuLabel>
          <MenuButton
            icon="assignment_turned_in"
            title="建立 Handoff"
            description={
              handoff.available
                ? '建立本機 Markdown；不會自動傳送或上傳'
                : handoff.reason
            }
            disabled={!handoff.available}
            onClick={() => choose(onCreateHandoff)}
          />

          <MenuLabel>工作方式</MenuLabel>
          <div className="grid grid-cols-2 gap-1 px-1 pb-1">
            {(['build', 'plan'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => choose(() => onAgentModeChange(mode))}
                className={`rounded-control px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
                  agentMode === mode
                    ? 'bg-hover-2 text-ink'
                    : 'text-ink-2 hover:bg-hover-2'
                }`}
              >
                <Icon name={mode === 'build' ? 'construction' : 'checklist'} size={16} className="mr-1.5 align-text-bottom" />
                {mode === 'build' ? 'Build' : '規劃模式'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1">
            {LOOPS.map((item) => (
              <button
                key={item.type ?? 'auto'}
                type="button"
                title={
                  item.type === null
                    ? '自動分類：短訊息回合制、複雜目標多步迴圈'
                    : item.label
                }
                onClick={() => choose(() => onLoopChange(item.type))}
                className={`flex flex-col items-center gap-1 rounded-control px-1 py-2 text-[10px] transition-colors ${
                  loopType === item.type
                    ? 'bg-accent-tint text-accent-ink'
                    : 'text-ink-2 hover:bg-hover-2'
                }`}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </button>
            ))}
          </div>

          <MenuLabel>自動化</MenuLabel>
          <MenuButton
            icon="schedule"
            title="定時任務"
            description="前往自動化建立可驗證的排程"
            onClick={() => choose(() => onOpenAutomation('schedule'))}
          />
          <MenuButton
            icon="bolt"
            title="事件觸發"
            description="前往自動化建立事件規則"
            onClick={() => choose(() => onOpenAutomation('event'))}
          />

          <MenuLabel>執行引擎</MenuLabel>
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {runners.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={!option.ready && option.id !== 'builtin'}
                title={option.ready ? option.blurb : `${option.label} 尚未授權`}
                onClick={() => choose(() => onRunnerChange(option.id))}
                className={`rounded-control px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  runner === option.id
                    ? 'bg-accent-tint text-accent-ink'
                    : 'bg-inset text-ink-2 hover:bg-hover-2'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <MenuLabel>更多</MenuLabel>
          <MenuButton icon="extension" title="擴充能力" description="管理連線、技能與外掛程式" onClick={() => choose(onOpenCapabilities)} />
          <MenuButton
            icon="vertical_split"
            title="任務面板"
            description={runPanelAvailable ? '查看目前執行進度' : '尚無任務執行紀錄'}
            disabled={!runPanelAvailable}
            onClick={() => choose(onToggleRunPanel)}
          />
          <MenuButton icon="terminal" title="終端機" description="開啟工作區終端" onClick={() => choose(onToggleTerminal)} />
        </div>
      ) : null}
    </div>
  )
}

function MenuLabel({ children }: { children: string }) {
  return <p className="px-2 pt-2 pb-1 text-[11px] font-semibold text-ink-3">{children}</p>
}

function MenuButton({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: string
  title: string
  description: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-left transition-colors hover:bg-hover-2 disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Icon name={icon} size={19} className="shrink-0 text-ink-2" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[11px] text-ink-3">{description}</span>
      </span>
    </button>
  )
}
