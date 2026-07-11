/**
 * Live in-chat process feed (Codex-style).
 * Always visible while a run is active; completed work is also written into
 * ThreadRunSummary bubbles via runExternal (RunSummaryCard).
 */

import { useMemo, useState } from 'react'
import { useAgentStore } from '../store/agentStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'

function basen(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'tool':
      return 'terminal'
    case 'file':
      return 'edit'
    case 'thought':
      return 'psychology'
    case 'error':
      return 'error'
    case 'done':
      return 'check_circle'
    case 'step':
      return 'checklist'
    default:
      return 'bolt'
  }
}

export function RunProcessFeed({
  depthLabel,
  onOpenPanel,
}: {
  depthLabel: string
  onOpenPanel?: () => void
}) {
  const agent = useAgentStore((s) => s.agent)
  const isRunning = useAgentStore((s) => s.isRunning)
  const {
    active: activityActive,
    events,
    thought,
    draftText,
    statusLine,
    fileChanges,
  } = useRunActivityStore()

  const [thoughtOpen, setThoughtOpen] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const live =
    isRunning ||
    activityActive ||
    agent.status === 'running' ||
    agent.status === 'parsing' ||
    agent.status === 'manual_intervention' ||
    agent.status === 'awaiting_user'

  /** Flat timeline: stream events + steps + toolCalls + recent logs */
  const timeline = useMemo(() => {
    const rows: Array<{
      id: string
      kind: string
      title: string
      detail?: string
      path?: string
      ok?: boolean
    }> = []
    const seen = new Set<string>()

    const add = (row: (typeof rows)[0]) => {
      if (seen.has(row.id)) return
      seen.add(row.id)
      rows.push(row)
    }

    for (const e of events) {
      if (e.kind === 'thought' || e.kind === 'text') continue
      if (e.kind === 'log' && (e.title === 'stdout' || e.title === 'stderr')) continue
      add({
        id: e.id,
        kind: e.kind,
        title:
          e.kind === 'tool'
            ? e.title || '已執行指令'
            : e.kind === 'file'
              ? e.title || (e.path ? `已編輯 ${basen(e.path)}` : '已編輯檔案')
              : e.title || e.kind,
        detail: e.detail,
        path: e.path,
        ok: e.ok,
      })
    }

    for (const s of agent.steps || []) {
      add({
        id: `step_${s.step}_${s.action}`,
        kind: 'step',
        title: s.description || s.action || `步驟 ${s.step}`,
        detail:
          s.status === 'IN_PROGRESS'
            ? '進行中…'
            : s.status === 'FAILED'
              ? (s.result || '失敗').slice(0, 200)
              : s.status === 'COMPLETED'
                ? '完成'
                : s.status,
        ok: s.status !== 'FAILED',
      })
    }

    for (const t of agent.toolCalls || []) {
      const path = String(t.input?.path ?? t.input?.file ?? t.input?.filePath ?? '')
      const isFile = /write|edit|create|patch/i.test(t.tool) && Boolean(path)
      add({
        id: `tc_${t.id}`,
        kind: isFile ? 'file' : 'tool',
        title: isFile
          ? `已編輯 ${basen(path)}`
          : /bash|shell/i.test(t.tool)
            ? '已執行指令'
            : `已執行 ${t.tool}`,
        detail:
          path ||
          (typeof t.input?.command === 'string'
            ? t.input.command
            : (t.output || '').slice(0, 160)),
        path: path || undefined,
        ok: t.ok,
      })
    }

    // Logs as last-resort process trail (CLI without structured stream)
    if (rows.length < 3) {
      for (const l of (agent.logs || []).slice(-12)) {
        const m = l.message || ''
        if (!m || m.startsWith('$ ') || m.length > 240) continue
        add({
          id: `log_${l.id}`,
          kind: l.level === 'ERROR' ? 'error' : 'status',
          title: m.slice(0, 160),
          detail: m,
          ok: l.level !== 'ERROR',
        })
      }
    }

    return rows.slice(-48)
  }, [events, agent.steps, agent.toolCalls, agent.logs])

  const allFiles = useMemo(() => {
    const map = new Map<string, { path: string; action: string; added?: number; removed?: number }>()
    for (const f of fileChanges) {
      map.set(f.path, {
        path: f.path,
        action: f.action,
        added: f.added,
        removed: f.removed,
      })
    }
    for (const t of agent.toolCalls || []) {
      if (!/write|edit|create|patch/i.test(t.tool)) continue
      const path = String(t.input?.path ?? t.input?.file ?? t.input?.filePath ?? '')
      if (path && !map.has(path)) {
        map.set(path, {
          path,
          action: /create|write/i.test(t.tool) ? 'create' : 'edit',
        })
      }
    }
    for (const e of events) {
      if (e.kind === 'file' && e.path && !map.has(e.path)) {
        map.set(e.path, { path: e.path, action: 'edit', added: e.added, removed: e.removed })
      }
    }
    return [...map.values()]
  }, [fileChanges, agent.toolCalls, events])

  // ALWAYS show while live — even before first event (spinner + objective)
  if (!live) return null

  return (
    <div className="w-full space-y-2.5 py-1">
      {/* Status line — no card chrome */}
      <div className="flex items-center gap-2 text-[12px] text-outline">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
        <span className="text-on-surface-variant min-w-0 truncate">
          {statusLine ||
            (agent.loopConfig?.trigger === 'local-cli'
              ? `本機 ${agent.steps[0]?.assignedAgent || 'CLI'} 執行中…`
              : `思考中（${depthLabel}）…`)}
        </span>
        <span className="ml-auto shrink-0 font-[family-name:var(--font-mono)] text-[10px]">
          {agent.progress}%
          {agent.objective ? ` · ${agent.objective.slice(0, 28)}` : ''}
        </span>
        {onOpenPanel ? (
          <button
            type="button"
            className="shrink-0 text-[11px] text-primary underline"
            onClick={onOpenPanel}
          >
            右側任務
          </button>
        ) : null}
      </div>

      {/* Thought */}
      {thought.trim() ? (
        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[12px] text-outline hover:text-on-surface"
            onClick={() => setThoughtOpen((v) => !v)}
          >
            <Icon name="psychology" size={15} className="text-secondary" />
            <span>思考過程</span>
            <span className="text-[10px] opacity-70">
              {thought.length.toLocaleString()} 字 · {thoughtOpen ? '收合' : '展開'}
            </span>
          </button>
          {thoughtOpen ? (
            <pre className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap pl-5 text-[12px] leading-relaxed text-on-surface-variant/90 font-[family-name:var(--font-mono)] custom-scrollbar">
              {thought}
            </pre>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[12px] text-outline/80">
          <Icon name="psychology" size={15} />
          <span>等待模型輸出過程…</span>
        </div>
      )}

      {/* Process rows — borderless */}
      {timeline.length > 0 ? (
        <div className="space-y-1">
          {timeline.map((row) => {
            const open = expanded === row.id
            return (
              <div key={row.id}>
                <button
                  type="button"
                  className={`flex max-w-full items-center gap-1.5 text-left text-[12px] ${
                    row.ok === false ? 'text-error' : 'text-outline hover:text-on-surface'
                  }`}
                  onClick={() => setExpanded((id) => (id === row.id ? null : row.id))}
                >
                  <Icon name={kindIcon(row.kind)} size={15} className="shrink-0 opacity-80" />
                  <span className="truncate">{row.title}</span>
                  {(row.detail || row.path) && row.detail !== row.title ? (
                    <Icon
                      name={open ? 'expand_less' : 'expand_more'}
                      size={14}
                      className="shrink-0 opacity-50"
                    />
                  ) : null}
                </button>
                {open && (row.detail || row.path) ? (
                  <pre className="ml-5 mt-0.5 whitespace-pre-wrap break-all text-[11px] text-on-surface-variant/80 font-[family-name:var(--font-mono)] line-clamp-5">
                    {row.path && row.path !== row.detail ? `${row.path}\n` : ''}
                    {row.detail}
                  </pre>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Files touched so far */}
      {allFiles.length > 0 ? (
        <div className="space-y-0.5">
          <div className="text-[11px] text-outline">已變更 {allFiles.length} 個檔案</div>
          {allFiles.slice(-8).map((f) => (
            <div
              key={f.path}
              className="flex items-center gap-1.5 text-[12px] text-outline font-[family-name:var(--font-mono)]"
            >
              <Icon name="edit" size={14} className="shrink-0" />
              <span className="truncate">{f.path.replace(/\\/g, '/')}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Streaming draft (markdown) */}
      {draftText ? (
        <div className="pt-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-outline">
            assistant · 串流中
          </div>
          <MarkdownBody content={draftText} />
        </div>
      ) : null}
    </div>
  )
}
