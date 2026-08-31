import { useMemo, useState } from 'react'
import type { SubDesignBrief } from '../../agent/subdesign/types'
import type { SubDesignWorkspaceViewModel } from '../../agent/subdesign/workspace'
import type { Thread, ThreadBubble } from '../../store/threadStore'
import { Icon } from '../Icon'
import { MarkdownBody } from '../MarkdownBody'
import { RunProcessFeed } from '../RunProcessFeed'
import { AgentThinking } from '../primitives/AgentThinking'
import { thinkingVariantForStage } from '../primitives/agentThinkingVariant'
import { ComposerLoader } from '../primitives/ComposerLoader'
import { RunSummaryCard } from '../RunSummaryCard'
import { ReferenceImportPanel } from './ReferenceImportPanel'

type SubDesignConversationPaneProps = {
  brief: SubDesignBrief
  workspace: SubDesignWorkspaceViewModel
  thread: Thread | null
  runIsLive: boolean
  runId: string | null
  startingRun: boolean
  onOpenTranscript: () => void
  onStartRun: () => void
  onStopRun: () => void
  onSubmitFollowUp: (value: string) => Promise<void>
}

const SURFACE_LABEL: Record<SubDesignBrief['surface'], string> = {
  prototype: 'Prototype',
  dashboard: 'Dashboard',
  deck: 'Deck',
  video: 'Video',
}

type ComposerChoice = {
  token: string
  label: string
  description: string
  icon: string
}

const SUBDESIGN_COMMANDS: ComposerChoice[] = [
  { token: '/direction', label: '/direction', description: '比較或鎖定視覺方向', icon: 'route' },
  { token: '/critique', label: '/critique', description: '執行目前 artifact 評圖', icon: 'rate_review' },
  { token: '/tweak', label: '/tweak', description: '描述要局部修訂的內容', icon: 'tune' },
  { token: '/deliver', label: '/deliver', description: '準備交付與輸出', icon: 'ios_share' },
]

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
  thread,
  runIsLive,
  runId,
  startingRun,
  onOpenTranscript,
  onStartRun,
  onStopRun,
  onSubmitFollowUp,
}: SubDesignConversationPaneProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [suggestionsHidden, setSuggestionsHidden] = useState(false)

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
  const sourceChoices = useMemo<ComposerChoice[]>(() => [
    ...(brief.references || []).map((reference) => ({
      token: `@reference:${reference.id}`,
      label: reference.title || reference.source,
      description: reference.storedPath,
      icon: reference.kind === 'screenshot' ? 'image' : 'link',
    })),
    ...(brief.provenance || []).map((source) => ({
      token: `@source:${source.recordId || source.digest.slice(0, 10)}`,
      label: source.title || source.sourcePath || 'OpenDesign source',
      description: source.sourcePath || source.sourceUrl,
      icon: 'inventory_2',
    })),
    { token: '@DESIGN.md', label: 'DESIGN.md', description: '專案提供的設計參考', icon: 'description' },
    { token: '@project', label: 'Project files', description: '目前 Restricted Project View', icon: 'folder_open' },
    { token: '@web', label: 'Web reference', description: '要求 Agent 查找公開參考', icon: 'language' },
  ], [brief.provenance, brief.references])
  const attachedSourceChoices = sourceChoices.filter((choice) => choice.token.startsWith('@reference:') || choice.token.startsWith('@source:'))
  const tokenMatch = /(^|\s)([@/])([^\s]*)$/.exec(draft)
  const tokenQuery = (tokenMatch?.[3] || '').toLocaleLowerCase()
  const composerChoices = tokenMatch?.[2] === '@' ? sourceChoices : tokenMatch?.[2] === '/' ? SUBDESIGN_COMMANDS : []
  const suggestions = suggestionsHidden ? [] : composerChoices
    .filter((choice) => `${choice.token} ${choice.label}`.toLocaleLowerCase().includes(tokenQuery))
    .slice(0, 6)

  const chooseSuggestion = (choice: ComposerChoice) => {
    if (!tokenMatch) return
    const tokenStart = tokenMatch.index + tokenMatch[1].length
    setDraft(`${draft.slice(0, tokenStart)}${choice.token} `)
    setSuggestionsHidden(true)
  }

  const openSourceMenu = () => {
    setDraft((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}@`)
    setSuggestionsHidden(false)
  }

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
          <span className={`inline-flex shrink-0 items-center gap-1.5 text-[9px] font-medium ${waitingForUser ? 'text-secondary' : activelyComputing ? 'text-primary' : 'text-outline'}`}>
            {activelyComputing ? <AgentThinking variant={thinkingVariantForStage(workspace.currentStage)} /> : null}
            {waitingForUser ? '等待回覆' : activelyComputing ? '執行中' : '可輸入'}
          </span>
        </div>

        <div className="relative rounded-[14px] border border-white/[0.08] bg-white/[0.035] p-2 shadow-card focus-within:border-white/[0.16] focus-within:bg-white/[0.05]">
          <ComposerLoader active={activelyComputing} />

          {attachedSourceChoices.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached SubDesign sources">
              {attachedSourceChoices.slice(0, 3).map((choice) => (
                <button
                  key={choice.token}
                  type="button"
                  onClick={() => setDraft((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${choice.token} `)}
                  className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-white/[0.055] px-2 text-[9px] text-on-surface-variant transition-colors hover:bg-white/[0.09]"
                  title={choice.description}
                >
                  <Icon name={choice.icon} size={11} className="shrink-0 text-outline" />
                  <span className="max-w-36 truncate">{choice.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          {suggestions.length ? (
            <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-white/[0.1] bg-surface-container shadow-raised" role="listbox" aria-label={tokenMatch?.[2] === '@' ? 'SubDesign sources' : 'SubDesign commands'}>
              {suggestions.map((choice) => (
                <button
                  key={choice.token}
                  type="button"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(choice)}
                  className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <Icon name={choice.icon} size={14} className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-semibold text-on-surface">{choice.label}</span>
                    <span className="block truncate text-[9px] text-outline">{choice.description}</span>
                  </span>
                  <span className="font-mono text-[9px] text-outline">{choice.token}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-[28px_minmax(0,1fr)_auto_32px] items-end gap-1">
            <button
              type="button"
              onClick={openSourceMenu}
              className="grid h-7 w-7 place-items-center rounded-lg text-outline transition-colors hover:bg-white/[0.07] hover:text-on-surface"
              aria-label="加入來源或參考"
            >
              <Icon name="add" size={15} />
            </button>
            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setSuggestionsHidden(false)
              }}
              onKeyDown={(event) => {
                if (suggestions[0] && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
                  event.preventDefault()
                  chooseSuggestion(suggestions[0])
                  return
                }
                if (event.key === 'Escape') {
                  setSuggestionsHidden(true)
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
              disabled={submitting}
              placeholder={activelyComputing ? '輸入可轉向或排隊的後續指令…' : waitingForUser ? '回覆目前問題…' : '輸入 @來源、/指令或後續要求…'}
              aria-label="SubDesign 指令輸入"
              className="min-h-8 max-h-28 w-full resize-none bg-transparent px-1 py-1.5 text-[12px] leading-relaxed text-on-surface outline-none placeholder:text-outline/65 disabled:cursor-not-allowed"
            />
            <span className="mb-1 inline-flex h-6 max-w-24 items-center gap-1 rounded-md px-1.5 text-[9px] text-outline" title={thread?.model || thread?.runner || '使用全域模型'}>
              <Icon name="neurology" size={11} />
              <span className="truncate">{thread?.model || thread?.runner || '模型'}</span>
            </span>
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

          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2">
            {SUBDESIGN_COMMANDS.map((command) => (
              <button
                key={command.token}
                type="button"
                onClick={() => setDraft((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${command.token} `)}
                className="rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[9px] text-outline transition-colors hover:bg-white/[0.08] hover:text-on-surface"
                title={command.description}
              >
                {command.token}
              </button>
            ))}
            <span className="ml-auto text-[9px] text-outline">Shift + Enter 換行</span>
            {runIsLive ? (
              <button
                type="button"
                onClick={onStopRun}
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-error/12 px-2.5 text-[9px] font-semibold text-error transition-colors hover:bg-error/18"
              >
                <Icon name="stop" size={12} />停止
              </button>
            ) : null}
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
