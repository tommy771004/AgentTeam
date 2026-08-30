/**
 * One renderer for a run's interleaved timeline — the narration, the thoughts,
 * and one line per tool call carrying the diff size the tool's own declaration
 * reports (「已編輯 x.ts +10 −0」).
 *
 * The live feed and the settled summary card both render through this, so the
 * process you watched and the process you read back are the same rows, never
 * two renderings of two sources.
 */

import { useState } from 'react'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'
import { ContextCards } from './ContextCards'
import { Reveal } from './primitives/Reveal'
import { ShimmerLabel } from './primitives/ShimmerLabel'
import { groupTimelineItems, timelineToolKind, type TimelineDisplayEntry } from './timelineGrouping'
import type { ProcessOperation } from '../lib/runPresentation'
import { UnifiedDiffView } from './UnifiedDiffView'

export type TimelineItem =
  | { id: string; kind: 'reasoning'; content: string; chars: number }
  | { id: string; kind: 'assistant'; content: string; phase?: 'commentary' | 'final_answer'; draft?: boolean }
  | { id: string; kind: 'notice'; content: string }
  | { id: string; kind: 'context'; summary: string; operations: ProcessOperation[] }
  | {
      id: string
      kind: 'tool'
      tool: string
      title?: string
      settlement?: string
      detail?: string
      resultDetail?: string
      diff?: string
      added?: number
      removed?: number
      approval?: string
      approvalReason?: string
    }

function TraceChevron({ open }: { open: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 text-ink-3 transition-transform duration-300 motion-reduce:transition-none"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <Icon name="expand_more" size={14} />
    </span>
  )
}

function rowAnimation(index: number) {
  return { animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index, 6) * 60}ms both` }
}

function ReasoningTimelineRow({ row, open, toggle, index }: { row: Extract<TimelineItem, { kind: 'reasoning' }>; open: boolean; toggle: () => void; index: number }) {
  return (
    <div style={rowAnimation(index)}>
      <button type="button" aria-expanded={open} data-timeline-row="reasoning" className="agent-process-row flex w-full max-w-full min-w-0 items-center gap-2 text-left text-[12px] text-ink-2" onClick={toggle}>
        <Icon name="auto_awesome" size={15} className="shrink-0 text-ink-3" />
        <span className="shrink-0 font-medium">已思考</span>
        <span className="agent-process-chip inline-flex min-w-0 max-w-full shrink truncate px-1.5 py-0.5 text-[11.5px]">{row.chars.toLocaleString()} 字</span>
        <TraceChevron open={open} />
      </button>
      <Reveal open={open}>
        <div className="agent-process-detail ml-5 mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2 custom-scrollbar">{row.content}</div>
      </Reveal>
    </div>
  )
}

function ContextTimelineRow({ row, open, toggle, index }: { row: Extract<TimelineItem, { kind: 'context' }>; open: boolean; toggle: () => void; index: number }) {
  return (
    <div style={rowAnimation(index)}>
      <button type="button" aria-expanded={open} data-timeline-row="context" className="agent-process-row flex w-full max-w-full min-w-0 items-center gap-2 text-left text-[12px] text-ink-2" onClick={toggle}>
        <Icon name="travel_explore" size={15} className="shrink-0 text-ink-3" />
        <span className="shrink-0 font-medium">已搜尋上下文</span>
        <span className="agent-process-chip inline-flex min-w-0 max-w-full shrink truncate px-1.5 py-0.5 text-[11.5px]">{row.summary}</span>
        <TraceChevron open={open} />
      </button>
      <Reveal open={open}><ContextCards operations={row.operations} /></Reveal>
    </div>
  )
}

function AssistantTimelineRow({ row }: { row: Extract<TimelineItem, { kind: 'assistant' }> }) {
  return (
    <div
      className={row.draft ? 'agent-streaming-answer py-2' : 'py-2'}
      data-assistant-phase={row.phase || 'legacy'}
      data-timeline-row={row.draft ? 'assistant-draft' : 'assistant'}
    >
      <div className={row.draft ? 'agent-streaming-body' : ''} style={row.draft ? { animation: 'stream-in 420ms cubic-bezier(0.22,0.61,0.25,1) both' } : undefined}>
        <MarkdownBody content={row.content} streaming={row.draft} />
      </div>
    </div>
  )
}

function ToolDiffStats({ row }: { row: Extract<TimelineItem, { kind: 'tool' }> }) {
  if ((row.added === undefined && row.removed === undefined) || (!row.added && !row.removed)) return null
  return (
    <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)] tabular-nums">
      {row.added ? <span className="text-green">+{row.added}</span> : null}
      {row.removed ? <span className={row.added ? 'ml-1 text-red' : 'text-red'}>−{row.removed}</span> : null}
    </span>
  )
}

function ToolApproval({ row }: { row: Extract<TimelineItem, { kind: 'tool' }> }) {
  // Successful admission is already implied by the tool having run. Keep the
  // durable approval on the row for audit/replay, but do not repeat the raw
  // protocol word `allow` in the task conversation. A denial remains visible.
  if (!row.approval || row.approval === 'allow') return null
  return <span className="shrink-0 rounded bg-red-tint px-1.5 py-0.5 text-[10px] font-medium text-red" title={row.approvalReason || row.approval}>{row.approval}</span>
}

function isSearchTool(tool: string): boolean {
  return timelineToolKind(tool) === 'search'
}

function settledToolIcon(tool: string): string {
  switch (timelineToolKind(tool)) {
    case 'search': return 'search'
    case 'edit': return 'edit_note'
    case 'read': return 'description'
    case 'command': return 'terminal'
    case 'tool': return 'extension'
  }
}

function toolRowState(row: Extract<TimelineItem, { kind: 'tool' }>, grouped: boolean) {
  const pending = row.settlement === undefined
  const failed = row.settlement !== undefined && row.settlement !== 'success'
  return {
    pending,
    failed,
    search: isSearchTool(row.tool),
    expandable: Boolean(row.diff || (!grouped && row.resultDetail)),
    label: row.title || (pending ? `執行 ${row.tool}…` : failed ? `${row.tool} ${row.settlement}` : `已執行 ${row.tool}`),
  }
}

function ToolRowIcon({ row, pending, failed, expandable, open }: {
  row: Extract<TimelineItem, { kind: 'tool' }>
  pending: boolean
  failed: boolean
  expandable: boolean
  open: boolean
}) {
  const name = pending ? 'progress_activity' : failed ? 'error' : settledToolIcon(row.tool)
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <Icon
        name={name}
        size={15}
        className={`${pending ? 'animate-spin text-ink' : 'text-ink-3'} transition-opacity duration-100 ${expandable ? `group-hover/tool:opacity-0 ${open ? 'opacity-0' : ''}` : ''}`}
      />
      {expandable ? (
        <span className={`absolute inline-flex text-ink-3 transition-[opacity,transform] duration-150 group-hover/tool:opacity-100 ${open ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0'}`}>
          <Icon name="expand_more" size={13} />
        </span>
      ) : null}
    </span>
  )
}

function ToolRowDisclosure({ row, open, failed, grouped, expandable }: {
  row: Extract<TimelineItem, { kind: 'tool' }>
  open: boolean
  failed: boolean
  grouped: boolean
  expandable: boolean
}) {
  return (
    <>
      {expandable ? (
        <Reveal open={open}>
          {row.diff ? (
            <div className="agent-process-detail ml-5 mt-1 overflow-hidden rounded-control border border-line">
              <UnifiedDiffView diff={row.diff} maxHeightClass="max-h-[320px]" />
            </div>
          ) : (
            <pre className={`agent-process-detail ml-6 mt-1 whitespace-pre-wrap break-words text-[11px] font-[family-name:var(--font-mono)] ${failed ? 'text-red' : 'text-ink-2'}`}>{row.resultDetail}</pre>
          )}
        </Reveal>
      ) : null}
      {grouped && row.resultDetail ? (
        <pre className={`ml-6 mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed font-[family-name:var(--font-mono)] ${failed ? 'text-red' : 'text-ink-3'}`} data-tool-result-detail>{row.resultDetail}</pre>
      ) : null}
    </>
  )
}

function ToolTimelineRow({ row, open, toggle, index, grouped = false }: { row: Extract<TimelineItem, { kind: 'tool' }>; open: boolean; toggle: () => void; index: number; grouped?: boolean }) {
  const { pending, failed, label, search, expandable } = toolRowState(row, grouped)
  const rowClass = `agent-process-row group/tool flex w-full max-w-full min-w-0 items-center gap-2 text-left text-[12px] ${failed ? 'text-red' : 'text-ink-2'}`
  const rowContent = (
    <>
      <ToolRowIcon row={row} pending={pending} failed={failed} expandable={expandable} open={open} />
      <ShimmerLabel active={pending} className="shrink-0 font-medium">{label}</ShimmerLabel>
      {row.detail ? <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3 font-[family-name:var(--font-mono)]" title={row.detail}>{row.detail}</span> : null}
      <ToolDiffStats row={row} />
      <ToolApproval row={row} />
    </>
  )
  return (
    <div style={rowAnimation(index)}>
      {expandable ? (
        <button type="button" aria-expanded={open} data-timeline-row="tool" data-tool-variant={search ? 'search' : 'coding'} className={rowClass} onClick={toggle}>{rowContent}</button>
      ) : (
        <div data-timeline-row="tool" data-tool-variant={search ? 'search' : 'coding'} className={rowClass}>{rowContent}</div>
      )}
      <ToolRowDisclosure row={row} open={open} failed={failed} grouped={grouped} expandable={expandable} />
    </div>
  )
}

function TimelineRowView({ row, open, toggle, index, grouped = false }: { row: TimelineItem; open: boolean; toggle: () => void; index: number; grouped?: boolean }) {
  switch (row.kind) {
    case 'reasoning': return <ReasoningTimelineRow row={row} open={open} toggle={toggle} index={index} />
    case 'context': return <ContextTimelineRow row={row} open={open} toggle={toggle} index={index} />
    case 'assistant': return <AssistantTimelineRow row={row} />
    case 'notice': return <div className="agent-process-row flex max-w-full items-center gap-2 text-[12px] text-ink-3"><Icon name="info" size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{row.content}</span></div>
    case 'tool': return <ToolTimelineRow row={row} open={open} toggle={toggle} index={index} grouped={grouped} />
  }
}

function groupPresentation(group: Extract<TimelineDisplayEntry, { type: 'group' }>): { icon: string; label: string; failed: boolean } {
  const first = group.rows[0]
  const count = group.rows.length
  if (first.kind === 'reasoning') return { icon: 'auto_awesome', label: `已思考 ${count} 次`, failed: false }
  if (first.kind === 'context') return { icon: 'travel_explore', label: `已搜尋 ${count} 次上下文`, failed: false }
  if (first.kind !== 'tool') return { icon: 'more_horiz', label: `${count} 項活動`, failed: false }

  const failed = first.settlement !== undefined && first.settlement !== 'success'
  const pending = first.settlement === undefined
  if (failed) return { icon: 'error', label: `${count} 項工具執行失敗`, failed: true }
  if (pending) return { icon: 'progress_activity', label: `正在執行 ${count} 項活動…`, failed: false }
  switch (timelineToolKind(first.tool)) {
    case 'search': return { icon: 'search', label: `已搜尋 ${count} 項`, failed: false }
    case 'edit': return { icon: 'edit_note', label: `已編輯 ${count} 項`, failed: false }
    case 'read': return { icon: 'description', label: `已查看 ${count} 項`, failed: false }
    case 'command': return { icon: 'terminal', label: `執行了 ${count} 個指令`, failed: false }
    case 'tool': return { icon: 'extension', label: `已使用 ${count} 項工具`, failed: false }
  }
}

function TimelineActivityGroup({
  group,
  open,
  toggle,
  expandedRow,
  toggleRow,
}: {
  group: Extract<TimelineDisplayEntry, { type: 'group' }>
  open: boolean
  toggle: () => void
  expandedRow: string | null
  toggleRow: (id: string) => void
}) {
  const presentation = groupPresentation(group)
  const detailId = `timeline-group-${group.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return (
    <div data-timeline-group={group.key} style={rowAnimation(group.index)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        className={`agent-process-row flex w-full max-w-full items-center gap-2 text-left text-[12px] ${presentation.failed ? 'text-red' : 'text-ink-3'}`}
        onClick={toggle}
      >
        <Icon name={presentation.icon} size={15} className={`shrink-0 ${group.key.endsWith(':pending') ? 'animate-spin' : ''}`} />
        <span className="font-medium">{presentation.label}</span>
        <TraceChevron open={open} />
      </button>
      <Reveal open={open}>
        <div id={detailId} className="ml-6 mt-1.5 space-y-1.5" data-timeline-group-detail>
          {group.rows.map((row, offset) => (
            <TimelineRowView
              key={row.id}
              row={row}
              index={group.index + offset}
              open={expandedRow === row.id}
              toggle={() => toggleRow(row.id)}
              grouped
            />
          ))}
        </div>
      </Reveal>
    </div>
  )
}

export function RunTimelineList({ rows, hideReasoning = false }: { rows: readonly TimelineItem[]; hideReasoning?: boolean }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const visibleRows = hideReasoning ? rows.filter((row) => row.kind !== 'reasoning') : rows
  const entries = groupTimelineItems(visibleRows)
  const toggleRow = (id: string) => setExpandedRow((current) => (current === id ? null : id))
  const toggleGroup = (id: string) => setExpandedGroups((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <>{entries.map((entry) => entry.type === 'single'
    ? <TimelineRowView key={entry.row.id} row={entry.row} index={entry.index} open={expandedRow === entry.row.id} toggle={() => toggleRow(entry.row.id)} />
    : <TimelineActivityGroup key={entry.id} group={entry} open={expandedGroups.has(entry.id)} toggle={() => toggleGroup(entry.id)} expandedRow={expandedRow} toggleRow={toggleRow} />)}</>
}
