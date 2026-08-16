import { useEffect, useRef, useState } from 'react'
import type { HandoffAvailability } from '../agent/composerRunControls'
import { Icon } from './Icon'

type ComposerQuickActionsProps = {
  disabled: boolean
  projectRoot: string | null
  onAttach: () => void
  onPickProject: () => void
  onOpenCapabilities: () => void
  onToggleRunPanel: () => void
  onToggleTerminal: () => void
  onCreateThread: () => void
  handoff: HandoffAvailability
  onCreateHandoff: () => void
}

/**
 * Compact Codex-style + menu for adding content to the conversation.
 *
 * Loop Pattern / 執行引擎 / Build-Plan / 推理程度 已移入 ComposerAdvanced
 * （ticket 03）——這個選單只留「加東西進來」與少數面板開關。
 */
export function ComposerQuickActions({
  disabled,
  projectRoot,
  onAttach,
  onPickProject,
  onOpenCapabilities,
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

          <MenuLabel>更多</MenuLabel>
          <MenuButton icon="extension" title="擴充能力" description="管理連線、技能與外掛程式" onClick={() => choose(onOpenCapabilities)} />
          <MenuButton icon="vertical_split" title="任務面板" description="查看目前執行進度" onClick={() => choose(onToggleRunPanel)} />
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
