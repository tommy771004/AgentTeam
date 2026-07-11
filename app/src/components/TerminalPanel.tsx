import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useProjectStore } from '../store/projectStore'

type Tab = {
  id: string
  title: string
  cwd: string
  alive: boolean
  buffer: string
}

/**
 * 多頁籤互動 shell（軟 PTY：macOS/Linux 使用 interactive shell、Windows 使用 cmd.exe）
 */
export function TerminalPanel({ onClose }: { onClose?: () => void }) {
  const projectRoot = useProjectStore((s) => s.root)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const preRef = useRef<HTMLPreElement>(null)
  const active = tabs.find((t) => t.id === activeId) || null

  const append = useCallback((id: string, data: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, buffer: (t.buffer + data).slice(-120_000) }
          : t,
      ),
    )
  }, [])

  useEffect(() => {
    if (!window.subagents?.term?.onData) return
    const offData = window.subagents.term.onData(({ id, data }) => append(id, data))
    const offExit = window.subagents.term.onExit?.(({ id, code }) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, alive: false, buffer: t.buffer + `\n[exit ${code}]\n` }
            : t,
        ),
      )
    })
    return () => {
      offData?.()
      offExit?.()
    }
  }, [append])

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight })
  }, [active?.buffer])

  const newTab = async () => {
    if (!window.subagents?.term?.create) return
    const info = await window.subagents.term.create({
      cwd: projectRoot || undefined,
      title: `Shell ${(tabs.length || 0) + 1}`,
    })
    const tab: Tab = {
      id: info.id,
      title: info.title,
      cwd: info.cwd,
      alive: info.alive,
      buffer: '',
    }
    setTabs((t) => [...t, tab])
    setActiveId(info.id)
  }

  const closeTab = async (id: string) => {
    await window.subagents?.term?.kill(id)
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeId === id) setActiveId(next[0]?.id || null)
      return next
    })
  }

  const sendLine = async () => {
    if (!activeId || !active?.alive) return
    const line = input.endsWith('\n') ? input : input + '\n'
    setInput('')
    append(activeId, `$ ${input}\n`)
    await window.subagents?.term?.write(activeId, line)
  }

  // first tab
  useEffect(() => {
    if (tabs.length === 0 && window.subagents?.term) {
      void newTab()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!window.subagents?.term) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-outline text-sm p-6">
        終端需在 Electron 執行
        {onClose && (
          <button type="button" className="mt-3 text-primary text-xs" onClick={onClose}>
            關閉
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-[#0a0a0c] border-l border-white/10">
      <div className="shrink-0 h-10 flex items-center gap-1 px-2 border-b border-white/10 bg-[#121214]">
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto custom-scrollbar min-w-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveId(t.id)}
              className={`group flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] shrink-0 ${
                t.id === activeId
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:bg-white/5'
              }`}
            >
              <Icon name="terminal" size={12} />
              {t.title}
              {!t.alive && <span className="text-red-400">·</span>}
              <span
                role="button"
                tabIndex={0}
                className="opacity-0 group-hover:opacity-100 ml-0.5"
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTab(t.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void closeTab(t.id)
                }}
              >
                <Icon name="close" size={12} />
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => void newTab()}
            className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10"
            title="新分頁"
          >
            <Icon name="add" size={16} />
          </button>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-white/40 hover:text-white"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <pre
        ref={preRef}
        className="flex-1 min-h-0 overflow-auto custom-scrollbar p-3 text-[12px] font-[family-name:var(--font-mono)] text-green-100/90 whitespace-pre-wrap break-all"
      >
        {active?.buffer || '（空）'}
      </pre>
      <div className="shrink-0 border-t border-white/10 p-2 flex gap-2">
        <input
          value={input}
          disabled={!active?.alive}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void sendLine()
          }}
          placeholder={active?.alive ? '輸入指令…' : 'session 已結束'}
          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-[12px] font-[family-name:var(--font-mono)] text-white outline-none focus:border-primary/40"
          spellCheck={false}
        />
        <button
          type="button"
          disabled={!active?.alive || !input.trim()}
          onClick={() => void sendLine()}
          className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-semibold disabled:opacity-40"
        >
          送出
        </button>
      </div>
      <div className="px-2 pb-1 text-[9px] text-white/30 truncate">
        cwd: {active?.cwd || '—'} · 軟 PTY（系統 shell）
      </div>
    </div>
  )
}
