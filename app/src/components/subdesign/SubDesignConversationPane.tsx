import { useMemo, useState } from 'react'
import type { DesignSystemSummary, SubDesignBrief } from '../../agent/subdesign/types'
import type { SubDesignWorkspaceViewModel } from '../../agent/subdesign/workspace'
import type { Thread, ThreadBubble } from '../../store/threadStore'
import { Icon } from '../Icon'
import { MarkdownBody } from '../MarkdownBody'
import { RunProcessFeed } from '../RunProcessFeed'
import { RunSummaryCard } from '../RunSummaryCard'
import { ReferenceImportPanel } from './ReferenceImportPanel'

type SubDesignConversationPaneProps = {
  brief: SubDesignBrief
  workspace: SubDesignWorkspaceViewModel
  designSystem: DesignSystemSummary | null
  thread: Thread | null
  runIsLive: boolean
  runId: string | null
  startingRun: boolean
  onOpenDesignSystems: () => void
  onOpenTranscript: () => void
  onStartRun: () => void
  onStopRun: () => void
  onSubmitFollowUp: (value: string) => Promise<void>
}

const SURFACE_LABEL: Record<SubDesignBrief['surface'], string> = {
  prototype: 'Prototype',
  dashboard: 'Dashboard',
  'design-system': 'Design System',
  deck: 'Deck',
  video: 'Video',
}

function shortTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function ConversationMessage({ bubble, latest, brief }: { bubble: ThreadBubble; latest: boolean; brief: SubDesignBrief }) {
  const isUser = bubble.role === 'user'
  const content = isUser && bubble.content.startsWith('# SubDesign 設計任務')
    ? brief.objective
    : bubble.content
  return (
    <article className={`py-3 ${latest ? '' : 'border-b border-white/[0.055]'}`}>
      <div className="mb-1.5 flex items-center gap-2 text-[10px] text-outline">
        <Icon name={isUser ? 'person' : 'neurology'} size={14} className={isUser ? 'text-outline' : 'text-primary'} />
        <span className="font-semibold text-on-surface">{isUser ? '你' : 'SubDesign Agent'}</span>
        <span>{shortTime(bubble.at)}</span>
      </div>
      {bubble.runSummary ? <div className="mb-2"><RunSummaryCard summary={bubble.runSummary} /></div> : null}
      {isUser ? (
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-on-surface-variant">{content}</p>
      ) : (
        <div className="text-[12px] leading-relaxed text-on-surface-variant">
          <MarkdownBody content={content} />
        </div>
      )}
    </article>
  )
}

export function SubDesignConversationPane({
  brief,
  workspace,
  designSystem,
  thread,
  runIsLive,
  runId,
  startingRun,
  onOpenDesignSystems,
  onOpenTranscript,
  onStartRun,
  onStopRun,
  onSubmitFollowUp,
}: SubDesignConversationPaneProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const conversation = useMemo(
    () => (thread?.bubbles || []).filter((bubble) => bubble.role === 'user' || bubble.role === 'assistant'),
    [thread?.bubbles],
  )
  const hiddenCount = Math.max(0, conversation.length - 3)
  const visibleMessages = historyOpen ? conversation : conversation.slice(-3)
  const waitingForUser = workspace.runStatus === 'awaiting-user' || Boolean(thread?.awaitingReply)
  const activelyComputing = runIsLive && !waitingForUser
  const canSubmit = Boolean(draft.trim()) && !submitting
  const sourceCount = (brief.references?.length || 0) + (brief.provenance?.length || 0)

  const submit = async () => {
    const value = draft.trim()
    if (!value || !canSubmit) return
    setSubmitting(true)
    try {
      await onSubmitFollowUp(value)
      setDraft('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <aside className="flex min-h-0 flex-col border-b border-white/[0.08] bg-surface-container-low/25 lg:border-b-0 lg:border-r">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
        {hiddenCount > 0 ? (
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
            className="mb-1 inline-flex items-center gap-1.5 py-1 text-[10px] text-outline transition-colors hover:text-on-surface"
          >
            <Icon name={historyOpen ? 'expand_less' : 'history'} size={14} />
            {historyOpen ? '只顯示最近訊息' : `顯示較早的 ${hiddenCount} 則訊息`}
          </button>
        ) : null}

        {visibleMessages.length ? (
          <div>
            {visibleMessages.map((bubble, index) => (
              <ConversationMessage
                key={bubble.id}
                bubble={bubble}
                latest={index === visibleMessages.length - 1}
                brief={brief}
              />
            ))}
          </div>
        ) : (
          <div className="py-3">
            <div className="mb-1.5 flex items-center gap-2 text-[10px] text-outline">
              <Icon name="person" size={14} />
              <span className="font-semibold text-on-surface">你</span>
            </div>
            <p className="text-[12px] leading-relaxed text-on-surface-variant">{brief.objective}</p>
          </div>
        )}

        {runIsLive && runId ? (
          <div className="border-t border-white/[0.06] pt-2">
            <RunProcessFeed runId={runId} depthLabel="SubDesign" onOpenPanel={onOpenTranscript} />
          </div>
        ) : null}

        {!runIsLive && conversation.length === 0 ? (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <div className="flex items-start gap-2">
              <Icon name="neurology" size={15} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-semibold text-on-surface">Brief 已建立</p>
                <p className="mt-1 text-[10px] leading-relaxed text-outline">
                  Agent 會先整理敘事與視覺方向；artifact 登記後會直接出現在右側。
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-3 border-t border-white/[0.06] pt-2">
          <button
            type="button"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((value) => !value)}
            className="flex w-full items-center gap-2 py-1.5 text-left text-[10px] text-outline transition-colors hover:text-on-surface"
          >
            <Icon name="attach_file" size={14} />
            <span className="flex-1">來源與參考{sourceCount ? ` · ${sourceCount}` : ''}</span>
            <Icon name={sourcesOpen ? 'expand_less' : 'expand_more'} size={14} />
          </button>
          {sourcesOpen ? <div className="pt-1"><ReferenceImportPanel brief={brief} /></div> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.08] p-3">
        <div className="mb-2 flex min-w-0 items-center gap-2 text-[10px]">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.045] px-2 text-on-surface-variant">
            <Icon name={brief.surface === 'deck' ? 'slideshow' : 'design_services'} size={13} />
            {SURFACE_LABEL[brief.surface]}
          </span>
          <button
            type="button"
            onClick={onOpenDesignSystems}
            className="inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-white/[0.045] px-2 text-outline transition-colors hover:text-on-surface"
          >
            <Icon name="palette" size={13} />
            <span className="truncate">{designSystem?.title || 'Project default'}</span>
          </button>
          <span className={`shrink-0 text-[9px] font-medium ${waitingForUser ? 'text-secondary' : activelyComputing ? 'text-primary' : 'text-outline'}`}>
            {waitingForUser ? '等待回覆' : activelyComputing ? '執行中' : '可輸入'}
          </span>
        </div>

        <div className="rounded-xl bg-white/[0.035] p-2.5 focus-within:bg-white/[0.05]">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            disabled={submitting}
            placeholder={activelyComputing ? '輸入可轉向或排隊的後續指令…' : waitingForUser ? '回覆目前問題…' : '輸入後續指令…'}
            className="min-h-[64px] w-full resize-none bg-transparent text-[12px] leading-relaxed text-on-surface outline-none placeholder:text-outline/65 disabled:cursor-not-allowed"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[9px] text-outline">Shift + Enter 換行</span>
            <div className="flex items-center gap-2">
              {runIsLive ? (
                <button
                  type="button"
                  onClick={onStopRun}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-error/12 px-3 text-[10px] font-semibold text-error transition-colors hover:bg-error/18"
                >
                  <Icon name="stop" size={13} />停止
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
                className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="送出後續指令"
              >
                <Icon name={submitting ? 'progress_activity' : 'arrow_upward'} size={14} className={submitting ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>

        {!runIsLive && workspace.nextGate.action === 'start-build' ? (
          <button
            type="button"
            onClick={onStartRun}
            disabled={startingRun}
            className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-45"
          >
            <Icon name={startingRun ? 'progress_activity' : 'play_arrow'} size={14} className={startingRun ? 'animate-spin' : ''} />
            {startingRun ? '啟動中…' : workspace.currentStage === 'build' ? '開始 Build' : workspace.nextGate.title}
          </button>
        ) : null}
      </div>
    </aside>
  )
}
