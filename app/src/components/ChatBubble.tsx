import { useState } from 'react'
import { useThreadStore, type ThreadBubble } from '../store/threadStore'
import { AttachmentThumb } from './AttachmentThumb'
import { ChatAutomationSuggestion } from './ChatAutomationSuggestion'
import { ConfirmSheet } from './ConfirmSheet'
import { Icon } from './Icon'
import { MarkdownBody } from './MarkdownBody'

const COLLAPSE_AT = 1_200

/** Main conversation row: user bubbles keep their shape; assistant output stays borderless. */
export function ChatBubble({ bubble }: { bubble: ThreadBubble }) {
  const [expanded, setExpanded] = useState(false)
  const [rewinding, setRewinding] = useState(false)
  const [confirmingRewind, setConfirmingRewind] = useState(false)
  const [copied, setCopied] = useState(false)
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
    setConfirmingRewind(false)
    setRewinding(true)
    try {
      await thr.rewindToBubble(threadId, bubble.id)
    } finally {
      setRewinding(false)
    }
  }

  const copyAnswer = async () => {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(bubble.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  // 自動化建議以互動卡呈現：意圖在哪裡說出口，建立就在哪裡完成。
  if (bubble.role === 'system' && bubble.suggestion) {
    return (
      <ChatAutomationSuggestion
        suggestion={bubble.suggestion}
        threadId={useThreadStore.getState().activeId}
      />
    )
  }

  if (bubble.role === 'system') {
    return (
      <div className="flex w-full items-start gap-2 px-0.5 py-1 text-[11px] text-ink-3">
        <Icon aria-hidden name="info" size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0">
          <span className="block whitespace-pre-wrap break-words font-[family-name:var(--font-mono)]">
            {bubble.content}
          </span>
          {bubble.link ? (
            <a
              href={bubble.link.href}
              className="mt-1 inline-flex items-center gap-1 text-accent-ink underline-offset-2 hover:underline"
            >
              {bubble.link.label}
              <Icon aria-hidden name="arrow_forward" size={13} />
            </a>
          ) : null}
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
          onClick={() => setConfirmingRewind(true)}
          className="agent-chat-rewind mr-1.5 mt-2 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 group-hover:flex disabled:opacity-50"
        >
          <Icon name={rewinding ? 'progress_activity' : 'history'} size={15} />
        </button>
      ) : null}
      <ConfirmSheet
        open={confirmingRewind}
        tone="danger"
        title="回捲到此訊息？"
        description="此氣泡之後的對話會被截斷，agent 寫入的檔案將還原到此時點。外部改動過的檔案會跳過，不會被覆蓋。"
        confirmLabel="回捲"
        busy={rewinding}
        onConfirm={() => void onRewind()}
        onCancel={() => setConfirmingRewind(false)}
      />
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
          <>
            <div className="agent-assistant-label mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
              <span className="text-ink-3" aria-hidden="true">✦</span>
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
                className="agent-chat-expand mt-2 inline-flex items-center gap-1 text-[11px] text-accent-ink"
                onClick={() => setExpanded((value) => !value)}
              >
                <Icon name={expanded ? 'expand_less' : 'expand_more'} size={15} />
                {expanded ? '收合輸出' : `展開完整輸出（${bubble.content.length.toLocaleString()} 字）`}
              </button>
            ) : null}
            <div className="agent-chat-actions mt-1.5 flex items-center gap-0.5" aria-label="回答操作">
              <button
                type="button"
                className="agent-chat-action"
                onClick={() => void copyAnswer()}
                aria-label="複製回答"
                title={copied ? '已複製' : '複製回答'}
              >
                <Icon name={copied ? 'check' : 'content_copy'} size={14} />
              </button>
              <span className="ml-1 text-[10px] text-ink-3" aria-live="polite">
                {copied ? '已複製' : ''}
              </span>
            </div>
          </>
        ) : (
          <div className="whitespace-pre-wrap">{bubble.content}</div>
        )}
      </div>
    </div>
  )
}
