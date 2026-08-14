import { useEffect, useRef } from 'react'
import type { LogEntry, LogLevel } from '../agent/types'

const levelColor: Record<LogLevel, string> = {
  INFO: 'text-on-surface-variant',
  PROCESS: 'text-secondary',
  EXEC: 'text-primary',
  EVAL: 'text-primary-fixed-dim',
  SUCCESS: 'text-primary-container',
  WARN: 'text-tertiary-container',
  ERROR: 'text-error',
  DEBUG: 'text-outline',
  AWAIT: 'text-secondary',
  HALT: 'text-error',
  THOUGHT: 'text-secondary',
  ACTION: 'text-primary-fixed-dim',
  FATAL: 'text-error',
  System: 'text-outline',
}

export function LogViewer({ logs, live = false }: { logs: LogEntry[]; live?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <div className="agent-log-viewer font-[family-name:var(--font-mono)] text-[13px] leading-relaxed custom-scrollbar overflow-y-auto h-full p-4 space-y-0.5">
      {logs.map((log) => (
        <div key={log.id} className="agent-log-row flex gap-2 flex-wrap">
          <span className="text-outline shrink-0">[{log.timestamp}]</span>
          <span className={`font-medium shrink-0 ${levelColor[log.level] || 'text-on-surface-variant'}`}>
            {log.level}
          </span>
          <span className="text-on-surface-variant break-all">{log.message}</span>
        </div>
      ))}
      {live && (
        <div className="agent-log-cursor flex items-center gap-1 text-primary mt-1">
          <span className="inline-block w-1.5 h-4 bg-primary" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
