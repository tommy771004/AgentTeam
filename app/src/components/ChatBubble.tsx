import { useMemo, useState } from 'react'
import { useThreadStore, type ThreadBubble } from '../store/threadStore'
import { extractMarkdownSources } from '../lib/markdownSources'
import { AttachmentThumb } from './AttachmentThumb'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'
import { Reveal } from './primitives/Reveal'

const COLLAPSE_AT = 1_200

function AssistantBubbleContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const sources = useMemo(() => extractMarkdownSources(content), [content])
  const canCollapse = content.length > COLLAPSE_AT
  const collapsed = canCollapse && !expanded

  const copyAnswer = async () => {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <div className="agent-assistant-label mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <span className="text-ink-3" aria-hidden="true">✦</span>
        assistant
      </div>
      <div className={collapsed ? 'relative max-h-80 overflow-hidden' : ''}>
        <MarkdownBody content={content} />
        {collapsed ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent" /> : null}
      </div>
      {canCollapse ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="agent-chat-expand mt-2 inline-flex items-center gap-1 text-[11px] text-accent-ink"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={15} />
          {expanded ? '收合輸出' : `展開完整輸出（${content.length.toLocaleString()} 字）`}
        </button>
      ) : null}
      <div className="agent-chat-actions mt-1.5 flex items-center gap-0.5" aria-label="回答操作" style={{ animation: 'fade-in 350ms ease-out both' }}>
        <button type="button" className="agent-chat-action" onClick={() => void copyAnswer()} aria-label="複製回答" title={copied ? '已複製' : '複製回答'}>
          <Icon name={copied ? 'check' : 'content_copy'} size={14} />
        </button>
        <span className="ml-1 text-[10px] text-ink-3" aria-live="polite">{copied ? '已複製' : ''}</span>
        {sources.length > 0 ? (
          <button
            type="button"
            aria-expanded={sourcesOpen}
            className="ml-1.5 inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-hover-2"
            onClick={() => setSourcesOpen((value) => !value)}
          >
            <span className="flex -space-x-1" aria-hidden="true">
              {sources.slice(0, 3).map((source) => (
                <span key={source.href} className="inline-flex size-4 items-center justify-center rounded-full bg-inset text-ink-3 shadow-[0_0_0_1.5px_var(--color-background)]">
                  <Icon name="language" size={10} />
                </span>
              ))}
            </span>
            {sources.length} 個來源
            <Icon name="expand_more" size={13} className={`transition-transform duration-300 ${sourcesOpen ? 'rotate-180' : ''}`} />
          </button>
        ) : null}
      </div>
      {sources.length > 0 ? (
        <Reveal open={sourcesOpen}>
          <div className="mt-1.5 flex flex-col rounded-[10px] bg-inset p-1 shadow-hairline" aria-label="回答引用來源">
            {sources.map((source, index) => (
              <a
                key={source.href}
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-control px-1.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                style={{ animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${index * 60}ms both` }}
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-surface text-ink-3 shadow-hairline"><Icon name="language" size={11} /></span>
                <span className="min-w-0 flex-1 truncate font-medium">{source.label}</span>
                <span className="shrink-0 font-[family-name:var(--font-mono)] text-[10.5px] text-ink-3">{source.domain}</span>
              </a>
            ))}
          </div>
        </Reveal>
      ) : null}
    </>
  )
}

/** Main conversation row: user bubbles keep their shape; assistant output stays borderless. */
export function ChatBubble({ bubble }: { bubble: ThreadBubble }) {
  const [rewinding, setRewinding] = useState(false)
  const isUser = bubble.role === 'user'
  const isAssistant = bubble.role === 'assistant'
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
      <div className="flex w-full items-start gap-2 px-0.5 py-1 text-[11px] text-ink-3">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap break-words font-[family-name:var(--font-mono)]">
          {bubble.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`agent-chat-bubble group flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      {canRewind ? (
        <button
          type="button"
          title="回捲到此訊息（還原檔案並截斷之後對話）"
          aria-label="回捲到此訊息"
          disabled={rewinding}
          onClick={() => void onRewind()}
          className="agent-chat-rewind mr-1.5 mt-2 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 group-hover:flex disabled:opacity-50"
        >
          <Icon name={rewinding ? 'progress_activity' : 'history'} size={15} />
        </button>
      ) : null}
      <div
        className={
          isUser
            ? 'agent-user-bubble max-w-[85%] rounded-card border px-3.5 py-2.5 text-[13px] leading-relaxed break-words'
            : 'agent-assistant-bubble w-full max-w-full py-1 text-[13px] leading-relaxed break-words'
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
          <AssistantBubbleContent content={bubble.content} />
        ) : (
          <div className="whitespace-pre-wrap">{bubble.content}</div>
        )}
      </div>
    </div>
  )
}
