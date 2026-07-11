/**
 * Codex-style center process feed:
 * - Process rows: borderless (icon + label), no card chrome
 * - Final: file-change summary card (已編輯 N 個檔案)
 * - Streaming draft only while live; final answer = markdown assistant bubble
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

  const [thoughtOpen, setThoughtOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(true)
  const [expandedCmd, setExpandedCmd] = useState<string | null>(null)

  const live =
    isRunning ||
    activityActive ||
    agent.status === 'running' ||
    agent.status === 'parsing' ||
    agent.status === 'manual_intervention' ||
    agent.status === 'awaiting_user'

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

    // Builtin toolCalls not already covered
    for (const t of agent.toolCalls || []) {
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
  }, [events, agent.toolCalls])

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

  if (!hasProcess) return null

  return (
    <div className="w-full space-y-3">
      {/* Live status — minimal, no card frame */}
      {live && (
        <div className="flex items-center gap-2 text-[12px] text-outline px-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
          <span className="text-on-surface-variant">
            {statusLine ||
              (agent.loopConfig?.trigger === 'local-cli'
                ? '本機 CLI 執行中…'
                : `思考中（${depthLabel}）…`)}
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[10px] ml-auto">
            {agent.progress}%
            {agent.metrics?.executionMs
              ? ` · ${Math.round(agent.metrics.executionMs / 1000)}s`
              : ''}
          </span>
          {onOpenPanel && (
            <button
              type="button"
              className="text-primary text-[11px] underline shrink-0"
              onClick={onOpenPanel}
            >
              右側任務
            </button>
          )}
        </div>
      )}

      {/* Thought — borderless collapsible */}
      {thought.trim() ? (
        <div className="w-full">
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
          {thoughtOpen && (
            <pre className="mt-1.5 text-[12px] leading-relaxed text-on-surface-variant/90 whitespace-pre-wrap font-[family-name:var(--font-mono)] max-h-36 overflow-y-auto custom-scrollbar pl-5">
              {thought}
            </pre>
          )}
        </div>
      ) : null}

      {/* Process timeline — Codex style: no outer card, just rows */}
      {timeline.length > 0 && (
        <div className="w-full space-y-1.5">
          {timeline.map((row) => {
            const isCmd = row.kind === 'tool'
            const isFile = row.kind === 'file'
            const open = expandedCmd === row.id
            return (
              <div key={row.id} className="w-full">
                <button
                  type="button"
                  className={`flex items-center gap-1.5 text-[12px] text-left max-w-full ${
                    row.ok === false ? 'text-error' : 'text-outline hover:text-on-surface'
                  }`}
                  onClick={() =>
                    setExpandedCmd((id) => (id === row.id ? null : row.id))
                  }
                >
                  <Icon
                    name={
                      isFile
                        ? 'edit'
                        : isCmd
                          ? 'terminal'
                          : kindIcon(row.kind)
                    }
                    size={15}
                    className="shrink-0 opacity-80"
                  />
                  <span className="truncate">
                    {row.title}
                    {isFile && (row.added != null || row.removed != null) ? (
                      <span className="ml-1.5 font-[family-name:var(--font-mono)] text-[10px]">
                        {row.added != null ? (
                          <span className="text-primary">+{row.added}</span>
                        ) : null}
                        {row.removed != null ? (
                          <span className="text-error ml-1">-{row.removed}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  {(row.detail || row.path) && (
                    <Icon
                      name={open ? 'expand_less' : 'expand_more'}
                      size={14}
                      className="shrink-0 opacity-50"
                    />
                  )}
                </button>
                {open && (row.detail || row.path) && (
                  <pre className="mt-1 ml-5 text-[11px] text-on-surface-variant/80 whitespace-pre-wrap break-all font-[family-name:var(--font-mono)] line-clamp-6">
                    {row.path && row.path !== row.detail ? `${row.path}\n` : ''}
                    {row.detail}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Streaming draft — light, no heavy frame */}
      {live && draftText ? (
        <div className="w-full pl-0.5">
          <div className="text-[10px] uppercase tracking-wider text-outline mb-1 font-semibold">
            assistant · 串流中
          </div>
          <MarkdownBody content={draftText} />
        </div>
      ) : null}

      {/* Final file summary — the one card Codex keeps at the end */}
      {!live && allFiles.length > 0 && (
        <div className="w-full rounded-xl border border-white/10 bg-surface-container/50 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5"
            onClick={() => setFilesOpen((v) => !v)}
          >
            <Icon name="folder_copy" size={16} className="text-primary shrink-0" />
            <span className="text-sm text-on-surface font-medium">
              已編輯 {allFiles.length} 個檔案
            </span>
            {(totalAdded > 0 || totalRemoved > 0) && (
              <span className="text-[11px] font-[family-name:var(--font-mono)] ml-1">
                {totalAdded > 0 && (
                  <span className="text-primary">+{totalAdded}</span>
                )}
                {totalRemoved > 0 && (
                  <span className="text-error ml-1">-{totalRemoved}</span>
                )}
              </span>
            )}
            <span className="ml-auto text-[11px] text-outline">
              {filesOpen ? '收合' : '查看'}
            </span>
          </button>
          {filesOpen && (
            <div className="border-t border-white/8 max-h-52 overflow-y-auto custom-scrollbar">
              {allFiles.map((f) => (
                <div
                  key={f.path}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-[family-name:var(--font-mono)] border-b border-white/5 last:border-0"
                >
                  <Icon
                    name={f.action === 'create' ? 'note_add' : 'edit'}
                    size={14}
                    className="text-outline shrink-0"
                  />
                  <span className="text-on-surface truncate flex-1" title={f.path}>
                    {f.path.replace(/\\/g, '/')}
                  </span>
                  <span className="shrink-0 text-[11px]">
                    {f.added != null && (
                      <span className="text-primary">+{f.added}</span>
                    )}
                    {f.removed != null && (
                      <span className="text-error ml-1">-{f.removed}</span>
                    )}
                    {f.added == null && f.removed == null && (
                      <span className="text-outline">
                        {f.action === 'create' ? '新增' : '修改'}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
