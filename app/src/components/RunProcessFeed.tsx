/**
 * Live in-chat process feed (OpenCode-style parts).
 * Always visible while a run is active; completed work is also written into
 * ThreadRunSummary bubbles via runExternal (RunSummaryCard).
 */

import { useMemo, useState } from 'react'
import { useAgentStore } from '../store/agentStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'
import {
  contextSummary,
  groupProcessOperations,
  type ProcessOperation,
} from '../lib/runPresentation'

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

function phaseLabel(input: {
  statusLine: string
  thought: string
  draftText: string
  operationCount: number
  objective: string
}) {
  if (input.draftText.trim()) return '正在撰寫回覆'
  if (input.thought.trim()) return '正在推理'
  if (input.operationCount > 0) return '正在執行任務'
  if (input.statusLine.trim()) return input.statusLine
  return input.objective ? '正在準備任務' : '正在啟動'
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

  // OpenCode keeps reasoning compact by default; raw streamed thought remains
  // available for inspection without pushing the answer below the fold.
  const [thoughtOpen, setThoughtOpen] = useState(false)
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
    const rows: ProcessOperation[] = []
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

    // Logs are a last-resort process trail for runners without structured
    // events. Do not mix engine diagnostics into an already useful parts view.
    if (rows.length === 0) {
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

  const groups = useMemo(() => groupProcessOperations(timeline), [timeline])
  const phase = phaseLabel({
    statusLine,
    thought,
    draftText,
    operationCount: timeline.length,
    objective: agent.objective,
  })

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
    <section className="w-full space-y-2.5 py-1" aria-live="polite" aria-busy={live}>
      {/* One stable turn status from prompt submission until the first part arrives. */}
      <div className="flex items-center gap-2 text-[12px] text-outline">
        <Icon name="progress_activity" size={15} className="shrink-0 animate-spin text-primary" />
        <span className="text-on-surface-variant min-w-0 truncate">
          {phase ||
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

      {/* Reasoning is an optional detail, not a competing second answer. */}
      {thought.trim() ? (
        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[12px] text-outline hover:text-on-surface"
            onClick={() => setThoughtOpen((v) => !v)}
          >
            <Icon name="psychology" size={15} className="text-secondary" />
            <span>推理摘要</span>
            <span className="text-[10px] opacity-70">
              {thought.length.toLocaleString()} 字 · {thoughtOpen ? '收合內容' : '檢視內容'}
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
          <span>等待模型開始回應…</span>
        </div>
      )}

      {/* Consecutive read/search parts become one OpenCode-style context group. */}
      {groups.length > 0 ? (
        <div className="space-y-1">
          {groups.map((group, index) => {
            const open = expanded === group.id
            const active = index === groups.length - 1 && !draftText.trim()
            if (group.type === 'context') {
              const detail = group.operations
                .map((operation) => operation.detail || operation.title)
                .filter(Boolean)
                .join('\n')
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    className="flex max-w-full items-center gap-1.5 text-left text-[12px] text-outline hover:text-on-surface"
                    onClick={() => setExpanded((id) => (id === group.id ? null : group.id))}
                  >
                    <Icon
                      name={active ? 'progress_activity' : 'folder_open'}
                      size={15}
                      className={active ? 'shrink-0 animate-spin text-primary' : 'shrink-0 opacity-80'}
                    />
                    <span className="truncate">{active ? '正在蒐集上下文' : '已蒐集上下文'}</span>
                    <span className="truncate text-[11px] text-outline/70">
                      {contextSummary(group.operations)}
                    </span>
                    <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 opacity-50" />
                  </button>
                  {open ? (
                    <pre className="ml-5 mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-[11px] text-on-surface-variant/80 font-[family-name:var(--font-mono)] custom-scrollbar">
                      {detail}
                    </pre>
                  ) : null}
                </div>
              )
            }

            const row = group.operation
            const hasDetail = Boolean((row.detail || row.path) && row.detail !== row.title)
            return (
              <div key={group.id}>
                <button
                  type="button"
                  className={`flex max-w-full items-center gap-1.5 text-left text-[12px] ${
                    row.ok === false ? 'text-error' : 'text-outline hover:text-on-surface'
                  }`}
                  onClick={() => hasDetail && setExpanded((id) => (id === group.id ? null : group.id))}
                >
                  <Icon
                    name={active ? 'progress_activity' : kindIcon(row.kind)}
                    size={15}
                    className={active ? 'shrink-0 animate-spin text-primary' : 'shrink-0 opacity-80'}
                  />
                  <span className="truncate">{row.title}</span>
                  {hasDetail ? <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 opacity-50" /> : null}
                </button>
                {open && hasDetail ? (
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
            assistant · 回覆中
          </div>
          <MarkdownBody content={draftText} />
        </div>
      ) : null}
    </section>
  )
}
