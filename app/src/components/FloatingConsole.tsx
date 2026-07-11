import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { CommandComposer } from './CommandComposer'
import { useWorkspaceUiStore } from '../store/workspaceUiStore'
import { useSlashExecutor } from '../hooks/useSlashExecutor'
import type { SlashCommand } from '../commands/registry'

/**
 * Codex 風格小視窗／浮動控制台 — 可拖曳、可切回全螢幕
 */
export function FloatingConsole() {
  const navigate = useNavigate()
  const {
    layoutMode,
    floatOpen,
    floatPos,
    setFloatPos,
    setFloatOpen,
    setLayoutMode,
    composer,
    setComposer,
    terminalLog,
  } = useWorkspaceUiStore()
  const { run, log } = useSlashExecutor()
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const visible = floatOpen && (layoutMode === 'float' || layoutMode === 'compact')

  useEffect(() => {
    if (!visible) return
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [terminalLog, visible])

  const onPointerDown = (e: ReactPointerEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('[data-drag-handle]')) return
    dragRef.current = { dx: e.clientX - floatPos.x, dy: e.clientY - floatPos.y }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return
    setFloatPos({
      x: Math.max(8, Math.min(window.innerWidth - 80, e.clientX - dragRef.current.dx)),
      y: Math.max(8, Math.min(window.innerHeight - 80, e.clientY - dragRef.current.dy)),
    })
  }

  const onPointerUp = () => {
    dragRef.current = null
    setDragging(false)
  }

  const onSlash = useCallback(
    async (cmd: SlashCommand, args: string, raw: string) => {
      log(`› ${raw}`)
      await run(cmd, args, raw)
    },
    [run, log],
  )

  if (!visible) return null

  return (
    <div
      className={`fixed z-[120] w-[min(420px,calc(100vw-16px))] rounded-2xl border border-primary/25 bg-surface/95 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.55)] overflow-hidden ${
        dragging ? 'cursor-grabbing' : ''
      }`}
      style={{ left: floatPos.x, top: floatPos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        data-drag-handle
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-surface-container-high/80 cursor-grab select-none"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Icon name="terminal" size={16} />
          控制台
          <span className="text-[10px] text-outline font-normal">小視窗 · 可拖曳</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="回到主對話"
            className="p-1.5 rounded hover:bg-white/10 text-on-surface-variant"
            onClick={() => {
              setLayoutMode('full')
              setFloatOpen(false)
              navigate('/')
            }}
          >
            <Icon name="open_in_full" size={16} />
          </button>
          <button
            type="button"
            title="關閉小視窗"
            className="p-1.5 rounded hover:bg-white/10 text-on-surface-variant"
            onClick={() => {
              setFloatOpen(false)
              setLayoutMode('full')
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div className="h-36 overflow-y-auto custom-scrollbar bg-[#060e20] px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-on-surface-variant space-y-0.5">
        {terminalLog.slice(-40).map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            <span className="text-outline select-none">┊ </span>
            {line}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      <div className="p-2 border-t border-white/10">
        <CommandComposer
          value={composer}
          onChange={setComposer}
          compact
          hideHints
          mode="workspace"
          // data-composer from mode; used as Cmd+/ fallback target
          placeholder="輸入 / 或 ⌘/ …"
          onSubmitLine={async (line) => {
            log(`› ${line}`)
            await run({ name: 'run', description: '執行', category: 'agent' }, line, line)
          }}
          onSlashCommand={onSlash}
        />
      </div>
    </div>
  )
}
