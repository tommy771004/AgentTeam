/**
 * Codex-style center process feed:
 * - Final answer remains an assistant bubble in the conversation.
 * - CLI work is grouped into one collapsible summary card, like Codex.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
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
    case 'status':
      return 'progress_activity'
    default:
      return 'bolt'
  }
}

/** Infer file paths from builtin toolCalls (workspace_write / …) */
function filesFromToolCalls(
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; ok: boolean }>,
) {
  const out: Array<{ path: string; action: 'edit' | 'create' | 'write' }> = []
  for (const t of toolCalls) {
    if (!t.ok) continue
    const name = t.tool || ''
    if (!/write|edit|create|patch|apply|mkdir/i.test(name)) continue
    const path = String(
      t.input?.path ?? t.input?.file ?? t.input?.filePath ?? t.input?.filename ?? '',
    )
    if (path) out.push({ path, action: /create|write/i.test(name) ? 'create' : 'edit' })
  }
  return out
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

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [expandedCmd, setExpandedCmd] = useState<string | null>(null)

  const live =
    isRunning ||
    activityActive ||
    agent.status === 'running' ||
    agent.status === 'parsing' ||
    agent.status === 'manual_intervention' ||
    agent.status === 'awaiting_user'
  const wasLive = useRef(false)

  useEffect(() => {
    if (live && !wasLive.current) setDetailsOpen(true)
    if (!live && wasLive.current) setDetailsOpen(false)
    wasLive.current = live
  }, [live])

  // Timeline rows: stream events + toolCalls, flat like Codex
  const timeline = useMemo(() => {
    const rows: Array<{
      id: string
      kind: string
      title: string
      detail?: string
      path?: string
      ok?: boolean
      added?: number
      removed?: number
    }> = []

    for (const e of events) {
      if (e.kind === 'thought' || e.kind === 'text') continue
      // Skip noisy init logs
      if (e.kind === 'log' && e.title === 'stdout') continue
      if (e.kind === 'status' && (e.title === '開始思考' || e.title === '產生回答')) {
        // keep as light process markers
      }
      rows.push({
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
        added: e.added,
        removed: e.removed,
      })
    }

    // CLI events already arrive through the live stream. Adding their mirrored
    // agent.toolCalls here duplicates every tool/file row in the conversation.
    const shouldAddToolCalls = agent.loopConfig?.trigger !== 'local-cli'
    for (const t of shouldAddToolCalls ? agent.toolCalls || [] : []) {
      const id = `tc_${t.id}`
      if (rows.some((r) => r.id === id)) continue
      const isFile = /write|edit|create|patch/i.test(t.tool)
      const path = String(
        t.input?.path ?? t.input?.file ?? t.input?.filePath ?? '',
      )
      rows.push({
        id,
        kind: isFile && path ? 'file' : 'tool',
        title: isFile && path
          ? `已編輯 ${basen(path)}`
          : /bash|shell/i.test(t.tool)
            ? '已執行指令'
            : `已執行 ${t.tool}`,
        detail:
          path ||
          (typeof t.input?.command === 'string'
            ? t.input.command
            : t.output?.slice(0, 120)),
        path: path || undefined,
        ok: t.ok,
      })
    }

    return rows.slice(-40)
  }, [events, agent.toolCalls, agent.loopConfig?.trigger])

  const allFiles = useMemo(() => {
    const map = new Map<
      string,
      { path: string; action: string; added?: number; removed?: number }
    >()
    for (const f of fileChanges) {
      map.set(f.path, {
        path: f.path,
        action: f.action,
        added: f.added,
        removed: f.removed,
      })
    }
    for (const f of filesFromToolCalls(agent.toolCalls || [])) {
      if (!map.has(f.path)) map.set(f.path, { path: f.path, action: f.action })
    }
    for (const e of events) {
      if (e.kind === 'file' && e.path && !map.has(e.path)) {
        map.set(e.path, {
          path: e.path,
          action: 'edit',
          added: e.added,
          removed: e.removed,
        })
      }
    }
    return [...map.values()]
  }, [fileChanges, agent.toolCalls, events])

  const totalAdded = allFiles.reduce((a, f) => a + (f.added || 0), 0)
  const totalRemoved = allFiles.reduce((a, f) => a + (f.removed || 0), 0)

  const hasProcess =
    live ||
    Boolean(thought?.trim()) ||
    timeline.length > 0 ||
    allFiles.length > 0 ||
    (live && Boolean(draftText))

  // Completed runs are persisted as a ThreadRunSummary beside their answer.
  // This component is only the live, in-flight view.
  if (!live || !hasProcess) return null

  const actionLabel = live
    ? statusLine ||
      (agent.loopConfig?.trigger === 'local-cli'
        ? '本機 CLI 執行中…'
        : `思考中（${depthLabel}）…`)
    : allFiles.length > 0
      ? `已變更 ${allFiles.length} 個檔案`
      : `已完成 ${timeline.length} 項操作`

  return (
    <section className="w-full overflow-hidden rounded-2xl border border-white/10 bg-surface-container/55">
      <button
        type="button"
        aria-expanded={detailsOpen}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.04]"
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <Icon
          name={live ? 'progress_activity' : allFiles.length ? 'note_stack' : 'terminal'}
          size={18}
          className={`shrink-0 ${live ? 'animate-spin text-primary' : 'text-on-surface-variant'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-on-surface">{actionLabel}</span>
          <span className="block text-[11px] text-outline">
            {timeline.length} 項操作
            {agent.metrics?.executionMs ? ` · ${Math.round(agent.metrics.executionMs / 1000)} 秒` : ''}
          </span>
        </span>
        {(totalAdded > 0 || totalRemoved > 0) && (
          <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)]">
            {totalAdded > 0 ? <span className="text-primary">+{totalAdded}</span> : null}
            {totalRemoved > 0 ? <span className="ml-1 text-error">-{totalRemoved}</span> : null}
          </span>
        )}
        <Icon name={detailsOpen ? 'expand_less' : 'expand_more'} size={18} className="shrink-0 text-outline" />
      </button>

      {detailsOpen ? (
        <div className="max-h-[420px] space-y-3 overflow-y-auto border-t border-white/8 px-3.5 py-3 custom-scrollbar">
          {thought.trim() ? (
            <details className="group">
              <summary className="cursor-pointer text-[12px] text-on-surface-variant marker:content-none">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="psychology" size={15} className="text-secondary" />
                  思考過程
                  <Icon name="expand_more" size={15} className="transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/15 p-2.5 text-[11px] leading-relaxed text-on-surface-variant font-[family-name:var(--font-mono)] custom-scrollbar">
                {thought}
              </pre>
            </details>
          ) : null}

          {live && draftText ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-outline">輸出中</p>
              <MarkdownBody content={draftText} />
            </div>
          ) : null}

          {timeline.length > 0 ? (
            <div className="space-y-1">
              {timeline.map((row) => {
                const isCmd = row.kind === 'tool'
                const isFile = row.kind === 'file'
                const open = expandedCmd === row.id
                return (
                  <div key={row.id}>
                    <button
                      type="button"
                      className={`flex max-w-full items-center gap-1.5 text-left text-[12px] ${
                        row.ok === false ? 'text-error' : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                      onClick={() => setExpandedCmd((id) => (id === row.id ? null : row.id))}
                    >
                      <Icon name={isFile ? 'edit' : isCmd ? 'terminal' : kindIcon(row.kind)} size={15} className="shrink-0 opacity-80" />
                      <span className="truncate">{row.title}</span>
                      {(row.detail || row.path) ? <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 opacity-50" /> : null}
                    </button>
                    {open && (row.detail || row.path) ? (
                      <pre className="ml-5 mt-1 whitespace-pre-wrap break-all rounded bg-black/15 p-2 text-[11px] text-on-surface-variant/80 font-[family-name:var(--font-mono)]">
                        {row.path && row.path !== row.detail ? `${row.path}\n` : ''}{row.detail}
                      </pre>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {allFiles.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-white/8">
              <div className="border-b border-white/8 px-2.5 py-2 text-[11px] font-medium text-on-surface-variant">變更檔案</div>
              {allFiles.map((file) => (
                <div key={file.path} className="flex items-center gap-2 border-b border-white/5 px-2.5 py-1.5 last:border-0">
                  <Icon name={file.action === 'create' ? 'note_add' : 'edit'} size={14} className="shrink-0 text-outline" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-on-surface font-[family-name:var(--font-mono)]" title={file.path}>{file.path.replace(/\\/g, '/')}</span>
                  <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)]">
                    {file.added != null ? <span className="text-primary">+{file.added}</span> : null}
                    {file.removed != null ? <span className="ml-1 text-error">-{file.removed}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {onOpenPanel ? <button type="button" className="text-[11px] text-primary hover:underline" onClick={onOpenPanel}>在任務面板查看完整紀錄</button> : null}
        </div>
      ) : null}
    </section>
  )
}
