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
import type { ProcessOperation } from '../lib/runPresentation'

export type TimelineItem =
  | { id: string; kind: 'reasoning'; content: string; chars: number }
  | { id: string; kind: 'assistant'; content: string; draft?: boolean }
  | { id: string; kind: 'notice'; content: string }
  | { id: string; kind: 'context'; summary: string; operations: ProcessOperation[] }
  | {
      id: string
      kind: 'tool'
      tool: string
      title?: string
      settlement?: string
      detail?: string
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
      <button type="button" aria-expanded={open} data-timeline-row="reasoning" className="agent-process-row flex w-full max-w-full items-center gap-2 text-left text-[12px] text-ink-2" onClick={toggle}>
        <Icon name="auto_awesome" size={15} className="shrink-0 text-ink-3" />
        <span className="shrink-0 font-medium">已思考</span>
        <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px]">{row.chars.toLocaleString()} 字</span>
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
      <button type="button" aria-expanded={open} data-timeline-row="context" className="agent-process-row flex w-full max-w-full items-center gap-2 text-left text-[12px] text-ink-2" onClick={toggle}>
        <Icon name="travel_explore" size={15} className="shrink-0 text-ink-3" />
        <span className="shrink-0 font-medium">已搜尋上下文</span>
        <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px]">{row.summary}</span>
        <TraceChevron open={open} />
      </button>
      <Reveal open={open}><ContextCards operations={row.operations} /></Reveal>
    </div>
  )
}

function AssistantTimelineRow({ row }: { row: Extract<TimelineItem, { kind: 'assistant' }> }) {
  return (
    <div className={row.draft ? 'agent-streaming-answer pt-1' : 'pt-1'} data-timeline-row={row.draft ? 'assistant-draft' : 'assistant'}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        assistant{row.draft ? ' · 回覆中' : ''}
      </div>
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
  if (!row.approval) return null
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${row.approval === 'deny' ? 'bg-red-tint text-red' : 'bg-inset text-ink-3'}`} title={row.approvalReason || row.approval}>{row.approval}</span>
}

function isSearchTool(tool: string): boolean {
  return /(?:search|grep|glob|find|web|fetch|browser)/i.test(tool)
}

function settledToolIcon(tool: string): string {
  if (isSearchTool(tool)) return 'search'
  if (/(?:write|edit|patch|create|replace)/i.test(tool)) return 'edit_note'
  if (/(?:read|view|open|image)/i.test(tool)) return 'description'
  if (/(?:bash|shell|exec|run|command|terminal)/i.test(tool)) return 'terminal'
  return 'extension'
}

function ToolTimelineRow({ row, open, toggle, index }: { row: Extract<TimelineItem, { kind: 'tool' }>; open: boolean; toggle: () => void; index: number }) {
  const pending = row.settlement === undefined
  const failed = row.settlement !== undefined && row.settlement !== 'success'
  const label = row.title || (pending ? `執行 ${row.tool}…` : failed ? `${row.tool} ${row.settlement}` : `已執行 ${row.tool}`)
  const search = isSearchTool(row.tool)
  const expandable = Boolean(row.detail)
  const rowClass = `agent-process-row group/tool flex w-full max-w-full items-center gap-2 text-left text-[12px] ${failed ? 'text-red' : 'text-ink-2'}`
  const rowContent = (
    <>
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <Icon
          name={pending ? 'progress_activity' : failed ? 'error' : settledToolIcon(row.tool)}
          size={15}
          className={`${pending ? 'animate-spin text-ink' : 'text-ink-3'} transition-opacity duration-100 ${expandable ? `group-hover/tool:opacity-0 ${open ? 'opacity-0' : ''}` : ''}`}
        />
        {expandable ? (
          <span className={`absolute inline-flex text-ink-3 transition-[opacity,transform] duration-150 group-hover/tool:opacity-100 ${open ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0'}`}>
            <Icon name="expand_more" size={13} />
          </span>
        ) : null}
      </span>
      <ShimmerLabel active={pending} className="shrink-0 font-medium">{label}</ShimmerLabel>
      <ToolDiffStats row={row} />
      <ToolApproval row={row} />
      {row.detail ? <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px] font-[family-name:var(--font-mono)]">{row.detail}</span> : null}
    </>
  )
  return (
    <div style={rowAnimation(index)}>
      {expandable ? (
        <button type="button" aria-expanded={open} data-timeline-row="tool" data-tool-variant={search ? 'search' : 'coding'} className={rowClass} onClick={toggle}>{rowContent}</button>
      ) : (
        <div data-timeline-row="tool" data-tool-variant={search ? 'search' : 'coding'} className={rowClass}>{rowContent}</div>
      )}
      <Reveal open={open && expandable}>
        <pre className="agent-process-detail ml-5 mt-0.5 whitespace-pre-wrap break-all text-[11px] text-ink-2 font-[family-name:var(--font-mono)] line-clamp-5">{row.detail}</pre>
      </Reveal>
    </div>
  )
}

function TimelineRowView({ row, open, toggle, index }: { row: TimelineItem; open: boolean; toggle: () => void; index: number }) {
  switch (row.kind) {
    case 'reasoning': return <ReasoningTimelineRow row={row} open={open} toggle={toggle} index={index} />
    case 'context': return <ContextTimelineRow row={row} open={open} toggle={toggle} index={index} />
    case 'assistant': return <AssistantTimelineRow row={row} />
    case 'notice': return <div className="agent-process-row flex max-w-full items-center gap-2 text-[12px] text-ink-3"><Icon name="info" size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{row.content}</span></div>
    case 'tool': return <ToolTimelineRow row={row} open={open} toggle={toggle} index={index} />
  }
}

export function RunTimelineList({ rows }: { rows: readonly TimelineItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return <>{rows.map((row, index) => <TimelineRowView key={row.id} row={row} index={index} open={expanded === row.id} toggle={() => setExpanded((id) => (id === row.id ? null : row.id))} />)}</>
}
