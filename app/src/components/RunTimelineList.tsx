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

export function RunTimelineList({ rows }: { rows: readonly TimelineItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <>
      {rows.map((row) => {
        const open = expanded === row.id
        if (row.kind === 'reasoning') {
          return (
            <div key={row.id} style={{ animation: 'fade-up 320ms cubic-bezier(0.23,1,0.32,1) both' }}>
              <button
                type="button"
                aria-expanded={open}
                data-timeline-row="reasoning"
                className="agent-process-row flex max-w-full items-center gap-2 text-left text-[12px] text-ink-2"
                onClick={() => setExpanded((id) => (id === row.id ? null : row.id))}
              >
                <Icon name="psychology" size={15} className="shrink-0 text-ink-3" />
                <span className="shrink-0 font-medium">推理</span>
                <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px]">
                  {row.chars.toLocaleString()} 字
                </span>
                <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" />
              </button>
              <Reveal open={open}>
                <pre className="agent-process-detail ml-5 mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-2 font-[family-name:var(--font-mono)] custom-scrollbar">
                  {row.content}
                </pre>
              </Reveal>
            </div>
          )
        }
        if (row.kind === 'context') {
          return (
            <div key={row.id}>
              <button
                type="button"
                aria-expanded={open}
                data-timeline-row="context"
                className="agent-process-row flex max-w-full items-center gap-2 text-left text-[12px] text-ink-2"
                onClick={() => setExpanded((id) => (id === row.id ? null : row.id))}
              >
                <Icon name="folder_open" size={15} className="shrink-0 opacity-80" />
                <span className="truncate">已蒐集上下文</span>
                <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px]">{row.summary}</span>
                <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" />
              </button>
              <Reveal open={open}>
                <ContextCards operations={row.operations} />
              </Reveal>
            </div>
          )
        }
        if (row.kind === 'assistant') {
          return (
            <div
              key={row.id}
              className={row.draft ? 'agent-streaming-answer pt-1' : 'pt-1'}
              data-timeline-row={row.draft ? 'assistant-draft' : 'assistant'}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                assistant{row.draft ? ' · 回覆中' : ''}
              </div>
              <div
                className={row.draft ? 'agent-streaming-body' : ''}
                style={row.draft ? { animation: 'stream-in 420ms cubic-bezier(0.22,0.61,0.25,1) both' } : undefined}
              >
                <MarkdownBody content={row.content} />
              </div>
            </div>
          )
        }
        if (row.kind === 'notice') {
          return (
            <div key={row.id} className="agent-process-row flex max-w-full items-center gap-2 text-[12px] text-ink-3">
              <Icon name="info" size={15} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{row.content}</span>
            </div>
          )
        }
        const pending = row.settlement === undefined
        const failed = row.settlement !== undefined && row.settlement !== 'success'
        const label = row.title
          || (pending ? `執行 ${row.tool}…` : failed ? `${row.tool} ${row.settlement}` : `已執行 ${row.tool}`)
        return (
          <div key={row.id} style={{ animation: 'fade-up 320ms cubic-bezier(0.23,1,0.32,1) both' }}>
            <button
              type="button"
              aria-expanded={row.detail ? open : undefined}
              data-timeline-row="tool"
              className={`agent-process-row flex max-w-full items-center gap-2 text-left text-[12px] ${failed ? 'text-red' : 'text-ink-2'}`}
              onClick={() => row.detail && setExpanded((id) => (id === row.id ? null : row.id))}
            >
              <Icon
                name={pending ? 'progress_activity' : failed ? 'error' : 'terminal'}
                size={15}
                className={pending ? 'shrink-0 animate-spin text-ink' : 'shrink-0 text-ink-3'}
              />
              <span className="shrink-0 font-medium">{label}</span>
              {(row.added !== undefined || row.removed !== undefined) && (row.added || row.removed) ? (
                <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)] tabular-nums">
                  {row.added ? <span className="text-green">+{row.added}</span> : null}
                  {row.removed ? <span className={row.added ? 'ml-1 text-red' : 'text-red'}>−{row.removed}</span> : null}
                </span>
              ) : null}
              {row.approval ? (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    row.approval === 'deny' ? 'bg-red-tint text-red' : 'bg-inset text-ink-3'
                  }`}
                  title={row.approvalReason || row.approval}
                >
                  {row.approval}
                </span>
              ) : null}
              {row.detail ? (
                <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px] font-[family-name:var(--font-mono)]">
                  {row.detail}
                </span>
              ) : null}
              {row.detail ? <Icon name={open ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" /> : null}
            </button>
            <Reveal open={open && Boolean(row.detail)}>
              <pre className="agent-process-detail ml-5 mt-0.5 whitespace-pre-wrap break-all text-[11px] text-ink-2 font-[family-name:var(--font-mono)] line-clamp-5">
                {row.detail}
              </pre>
            </Reveal>
          </div>
        )
      })}
    </>
  )
}
