import { useState } from 'react'
import type { ThreadBubble } from '../store/threadStore'
import { AttachmentThumb } from './AttachmentThumb'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'

const COLLAPSE_AT = 1_200

/** Main conversation row: user bubbles keep their shape; assistant output stays borderless. */
export function ChatBubble({ bubble }: { bubble: ThreadBubble }) {
  const [expanded, setExpanded] = useState(false)
  const isUser = bubble.role === 'user'
  const isAssistant = bubble.role === 'assistant'
  const canCollapse = isAssistant && bubble.content.length > COLLAPSE_AT
  const collapsed = canCollapse && !expanded

  if (bubble.role === 'system') {
    return (
      <div className="flex w-full items-start gap-2 px-0.5 py-1 text-[11px] text-outline">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap break-words font-[family-name:var(--font-mono)]">
          {bubble.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl border border-primary/25 bg-primary/15 px-3.5 py-2.5 text-sm leading-relaxed break-words'
            : 'w-full max-w-full py-1 text-sm leading-relaxed break-words'
        }
      >
        {bubble.attachments?.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {bubble.attachments.map((attachment) => (
              <AttachmentThumb key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}

        {isAssistant ? (
          <>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-outline">
              assistant
            </div>
            <div className={collapsed ? 'relative max-h-80 overflow-hidden' : ''}>
              <MarkdownBody content={bubble.content} />
              {collapsed ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent" />
              ) : null}
            </div>
            {canCollapse ? (
              <button
                type="button"
                aria-expanded={expanded}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary-fixed"
                onClick={() => setExpanded((value) => !value)}
              >
                <Icon name={expanded ? 'expand_less' : 'expand_more'} size={15} />
                {expanded ? '收合輸出' : `展開完整輸出（${bubble.content.length.toLocaleString()} 字）`}
              </button>
            ) : null}
          </>
        ) : (
          <div className="whitespace-pre-wrap">{bubble.content}</div>
        )}
      </div>
    </div>
  )
}
