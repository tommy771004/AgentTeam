import { useCallback, useEffect, useState } from 'react'
import { hasAgentTreeApi, hasAgentTreeCapability, projectAgentTreeSnapshot, type AgentTreeRow } from '../agent/agentTreeProjection'

type SessionSummary = { id: string; parentSessionId?: string }

function rootSessions(value: unknown): SessionSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter((session): session is SessionSummary => Boolean(
    session && typeof session === 'object'
    && typeof (session as SessionSummary).id === 'string'
    && (session as SessionSummary).parentSessionId === undefined,
  ))
}

const lifecycleTone: Record<AgentTreeRow['lifecycle'], string> = {
  queued: 'text-outline',
  admitted: 'text-on-surface-variant',
  running: 'text-primary',
  'waiting-approval': 'text-amber-400',
  blocked: 'text-amber-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-outline',
  interrupted: 'text-amber-400',
  unknown: 'text-outline',
}

/** Read-only diagnostic: every refresh is rebuilt from Host snapshots. */
export function AgentTreeDiagnostic() {
  const [rows, setRows] = useState<AgentTreeRow[]>([])
  const [message, setMessage] = useState('載入中…')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const piHost = window.subagents?.piHost
    if (!piHost?.sessions?.list || !piHost.status || !hasAgentTreeApi(piHost.agents)) {
      setRows([])
      setMessage('目前 Host 尚未提供 agent tree read model')
      return
    }
    setLoading(true)
    try {
      const status = await piHost.status()
      if (!hasAgentTreeCapability(status.capabilities)) {
        setRows([])
        setMessage('目前 Host 尚未協商 agent-tree-v1')
        return
      }
      const listed = await piHost.sessions.list()
      const roots = rootSessions(listed.sessions)
      const snapshots = await Promise.all(roots.map((root) => piHost.agents.list({ rootAgentId: root.id })))
      const next = snapshots.flatMap(projectAgentTreeSnapshot)
      setRows(next)
      setMessage(next.length > 0 ? '' : '尚無 Agent task')
    } catch (error) {
      setRows([])
      setMessage(error instanceof Error ? error.message : 'Agent tree 載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const unsubscribe = window.subagents?.piHost?.onEvent?.((event) => {
      if (event.event === 'host/agent-lifecycle') void refresh()
    })
    return () => { unsubscribe?.() }
  }, [refresh])

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] text-outline">Host-owned task path 與 lifecycle</p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-[11px] text-primary hover:text-primary/80 disabled:opacity-50"
        >
          {loading ? '同步中…' : '重新整理'}
        </button>
      </div>
      {message ? <p className="text-[12px] text-outline">{message}</p> : null}
      {rows.length > 0 ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto custom-scrollbar" aria-label="Agent task tree">
          {rows.map((row) => (
            <li key={row.key} className="min-w-0" style={{ paddingInlineStart: `${row.depth * 16}px` }}>
              <div className="flex min-w-0 items-baseline gap-2 text-[11px]">
                <span className={`shrink-0 font-[family-name:var(--font-mono)] ${lifecycleTone[row.lifecycle]}`}>{row.lifecycle}</span>
                <span className="truncate text-on-surface">{row.label}</span>
                {row.legacy ? <span className="shrink-0 text-outline">legacy</span> : null}
              </div>
              <p className="truncate font-[family-name:var(--font-mono)] text-[10px] text-outline">{row.taskPath}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
