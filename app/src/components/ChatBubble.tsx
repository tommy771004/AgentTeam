import { useState } from 'react'
import { useThreadStore, type ThreadBubble } from '../store/threadStore'
import { AttachmentThumb } from './AttachmentThumb'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'

const COLLAPSE_AT = 1_200

/** Main conversation row: user bubbles keep their shape; assistant output stays borderless. */
export function ChatBubble({ bubble }: { bubble: ThreadBubble }) {
  const [expanded, setExpanded] = useState(false)
  const [rewinding, setRewinding] = useState(false)
  const isUser = bubble.role === 'user'
  const isAssistant = bubble.role === 'assistant'
  const canCollapse = isAssistant && bubble.content.length > COLLAPSE_AT
  const collapsed = canCollapse && !expanded
  // G5 rewind:僅 Electron(有快照橋)且非執行中才提供
  const canRewind = isUser && Boolean(window.subagents?.rewind)

  const onRewind = async () => {
    if (rewinding) return
    const thr = useThreadStore.getState()
    const threadId = thr.activeId
    if (!threadId) return
    if (
      !window.confirm(
        '回捲到此訊息？此氣泡之後的對話會被截斷，agent 寫入的檔案將還原到此時點（外部改動過的檔案會跳過）。',
      )
    ) {
      return
    }
    setRewinding(true)
    try {
      await thr.rewindToBubble(threadId, bubble.id)
    } finally {
      setRewinding(false)
    }
  }

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
    <div className={`group flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      {canRewind ? (
        <button
          type="button"
          title="回捲到此訊息（還原檔案並截斷之後對話）"
          aria-label="回捲到此訊息"
          disabled={rewinding}
          onClick={() => void onRewind()}
          className="mr-1.5 mt-2 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container hover:text-primary group-hover:flex disabled:opacity-50"
        >
          <Icon name={rewinding ? 'progress_activity' : 'history'} size={15} />
        </button>
      ) : null}
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
