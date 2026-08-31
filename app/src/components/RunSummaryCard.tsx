import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ThreadRunSummary } from '../store/threadStore'
import { deriveRunLifecycle, lifecycleToneClass } from '../agent/runLifecycle'
import { Icon } from './Icon'
import { RunTimelineList, type TimelineItem } from './RunTimelineList'
import { RunTaskRow } from './RunTaskRow'
import { contextSummary, groupProcessOperations } from '../lib/runPresentation'
import { formatTokensCompact, formatUsd } from '../agent/contextUsageView'
import { AgentWorkTree } from './AgentWorkTree.tsx'
import { useWorkspacePanelSessionStore } from '../store/workspacePanelSessionStore.ts'
import { useThreadStore } from '../store/threadStore.ts'

/**
 * The persisted operations replay through the SAME timeline renderer the live
 * feed uses, so the process you watched and the process you read back are the
 * same rows — including the「+N −M」each mutating tool declared.
 */
function timelineItems(operations: ThreadRunSummary['operations']): TimelineItem[] {
  return groupProcessOperations(operations).map((group) => {
    if (group.type === 'context') {
      return {
        id: group.id,
        kind: 'context' as const,
        summary: contextSummary(group.operations),
        operations: group.operations,
      }
    }
    const operation = group.operation
    return {
      id: group.id,
      kind: 'tool' as const,
      tool: operation.title,
      title: operation.title,
      settlement: operation.ok === false ? 'failed' : 'success',
      ...(operation.ok === false
        ? {
            ...(operation.path ? { detail: operation.path } : {}),
            ...(operation.detail ? { resultDetail: operation.detail } : {}),
          }
        : { detail: operation.path && operation.path !== operation.detail ? `${operation.path}\n${operation.detail || ''}` : operation.detail }),
      added: operation.added,
      removed: operation.removed,
    }
  })
}

function RunChangedFilesCard({
  files,
  reviewSnapshotRef,
  additions,
  removals,
}: Pick<ThreadRunSummary, 'files' | 'reviewSnapshotRef'> & { additions: number; removals: number }) {
  const [allFilesOpen, setAllFilesOpen] = useState(false)
  if (!files.length) return null
  const visibleFiles = files.slice(0, allFilesOpen ? files.length : 3)
  const openReview = (path?: string) => {
    if (!reviewSnapshotRef) return
    const panel = useWorkspacePanelSessionStore.getState()
    const tabId = panel.openTab(
      { kind: 'review', target: { kind: 'run-snapshot', snapshotId: reviewSnapshotRef.snapshotId } },
      '變更檢視',
    )
    if (path) panel.selectPath(tabId, path)
    useThreadStore.getState().setShowRunPanel(true)
  }

  return (
    <section data-testid="run-summary-diff" data-summary-changes className="mt-2 overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex min-h-16 w-full items-center gap-3 border-b border-line px-3.5 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-inset text-ink-2">
          <Icon name="note_stack" size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">已編輯 {files.length} 個檔案</span>
          {(additions > 0 || removals > 0) ? (
            <span className="mt-0.5 block text-[12px] font-[family-name:var(--font-mono)] tabular-nums">
              {additions > 0 ? <span className="text-green">+{additions}</span> : null}
              {removals > 0 ? <span className="ml-1 text-red">−{removals}</span> : null}
            </span>
          ) : null}
        </span>
        {reviewSnapshotRef ? (
          <button
            type="button"
            onClick={() => openReview()}
            className="shrink-0 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="查看本次執行的變更"
          >
            查看
          </button>
        ) : null}
      </div>
      {visibleFiles.map((file) => {
        const content = <>
          <Icon name={file.action === 'create' ? 'note_add' : 'edit'} size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={file.path}>{file.path.replace(/\\/g, '/')}</span>
          <span className="shrink-0 text-[12px] font-[family-name:var(--font-mono)] tabular-nums">
            {file.added != null ? <span className="text-green">+{file.added}</span> : null}
            {file.removed != null ? <span className="ml-1 text-red">-{file.removed}</span> : null}
          </span>
        </>
        return reviewSnapshotRef ? (
          <button key={file.path} type="button" onClick={() => openReview(file.path)} className="flex w-full items-center gap-2 border-b border-line px-3.5 py-2 text-left transition-colors hover:bg-hover-1 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent">
            {content}
          </button>
        ) : (
          <div key={file.path} className="flex items-center gap-2 border-b border-line px-3.5 py-2">{content}</div>
        )
      })}
      {files.length > 3 ? (
        <button
          type="button"
          aria-expanded={allFilesOpen}
          onClick={() => setAllFilesOpen((value) => !value)}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12px] text-ink-2 hover:bg-hover-1 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent"
        >
          <span className="flex-1">{allFilesOpen ? '只顯示前 3 個檔案' : `顯示另外 ${files.length - 3} 個檔案`}</span>
          <Icon name={allFilesOpen ? 'expand_less' : 'expand_more'} size={15} className="text-ink-3" />
        </button>
      ) : null}
    </section>
  )
}

function HistoricalAgentWork({ summary }: { summary: ThreadRunSummary }) {
  if (!summary.agentWork) return null
  return <AgentWorkTree entries={summary.agentWork.entries} originTurn={summary.agentWork.originTurn} sessionId={summary.agentWork.sessionId} />
}

function hasExecutionSummary(summary: ThreadRunSummary, itemCount: number): boolean {
  return itemCount > 0
    || Boolean(summary.plan?.length)
    || Boolean(summary.agents?.length)
    || Boolean(summary.agentWork)
    || Boolean(summary.subDesign)
    || summary.files.length === 0
}

/** Persisted, collapsible record of what an agent did for one answer. */
export function RunSummaryCard({ summary }: { summary: ThreadRunSummary }) {
  const navigate = useNavigate()
  // Context is visible at a glance; details remain one click away.
  const [open, setOpen] = useState(false)
  const items = timelineItems(summary.operations)
  const additions = summary.files.reduce((total, file) => total + (file.added || 0), 0)
  const removals = summary.files.reduce((total, file) => total + (file.removed || 0), 0)
  const lifecycle = deriveRunLifecycle({
    status: summary.status || 'idle',
    terminal: Boolean(summary.status),
    orchestration: {
      iterations: summary.iterations,
      maxIterations: summary.maxIterations,
      dodMet: summary.dodMet,
      executionKind: summary.executionKind,
    },
    interruptReason: summary.interruptReason,
  })
  const outcome = summary.status ? lifecycle.label : ''
  const label = '執行過程'
  const showExecutionSummary = hasExecutionSummary(summary, items.length)

  return (
    <>
      {showExecutionSummary ? (
        <section data-testid="run-summary-card" className="agent-summary-card w-full overflow-hidden rounded-card border bg-surface shadow-card">
          <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="agent-summary-header flex w-full items-center gap-2 px-3.5 py-3 text-left"
      >
        <Icon
          name={summary.status ? lifecycle.icon : summary.files.length ? 'note_stack' : 'terminal'}
          size={18}
          className={`shrink-0 ${summary.status ? lifecycleToneClass(lifecycle.tone) : 'text-ink-2'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">{label}</span>
          <span className="block text-[11px] text-ink-3">
            {summary.operations.length} 項操作
            {summary.durationMs ? ` · ${Math.round(summary.durationMs / 1000)} 秒` : ''}
            {/* Measured or absent. An older summary carries neither and reads
                exactly as it always did. */}
            {summary.tokens === undefined ? null : (
              <span className="font-[family-name:var(--font-mono)] tabular-nums">
                {' · '}{formatTokensCompact(summary.tokens)} tok
              </span>
            )}
            {summary.costUsd === undefined ? null : (
              <span className="font-[family-name:var(--font-mono)] tabular-nums">
                {' · '}{formatUsd(summary.costUsd)}
              </span>
            )}
          </span>
        </span>
        {outcome ? (
          <span className={`shrink-0 text-[11px] font-medium ${lifecycleToneClass(lifecycle.tone)}`}>
            {outcome}
          </span>
        ) : null}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="shrink-0 text-ink-3" />
          </button>

          {summary.subDesign ? (
        <div className="border-t border-line bg-accent-tint px-3.5 py-3 text-[11px] text-ink-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
              <Icon name="palette" size={14} className="shrink-0 text-accent-ink" />
              <span>SubDesign · {summary.subDesign.stage}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/subdesign/${summary.subDesign?.briefId}`)}
              className="inline-flex shrink-0 items-center gap-1 rounded-control border border-line px-2 py-1 text-[11px] font-semibold text-accent-ink transition-colors hover:bg-hover-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <Icon name="open_in_new" size={13} />查看設計
            </button>
          </div>
          <div className="mt-1 text-ink-3">brief {summary.subDesign.briefId}{summary.subDesign.selectedDirectionId ? ` · direction ${summary.subDesign.selectedDirectionId}` : ' · 尚未選定 direction'}</div>
          {summary.subDesign.critique ? <div className="mt-1 text-ink-3">critique r{summary.subDesign.critique.revision} · {summary.subDesign.critique.verdict} · {summary.subDesign.critique.blockerCount} blockers</div> : null}
          {summary.subDesign.exports?.length ? <div className="mt-1 text-ink-3">exports · {summary.subDesign.exports.map((item) => `${item.format.toUpperCase()} r${item.revision}`).join(' · ')}</div> : null}
        </div>
          ) : null}

          {open ? (
            <div className="agent-summary-content max-h-[420px] space-y-3 overflow-y-auto border-t border-line px-3.5 py-3 custom-scrollbar">
          {items.length ? (
            <div className="agent-summary-trace space-y-1">
              <RunTimelineList rows={items} />
            </div>
          ) : null}

          <HistoricalAgentWork summary={summary} />

          {summary.plan?.length ? (
            <div className="agent-summary-section overflow-hidden rounded-card border border-line">
              <div className="border-b border-line px-2.5 py-2 text-[11px] font-medium text-ink-2">
                任務計畫 · {summary.plan.filter((item) => item.status === 'done').length}/{summary.plan.length}
              </div>
              <ul aria-label="任務計畫">
                {summary.plan.map((item, index) => (
                  <RunTaskRow
                    key={item.id}
                    text={item.text}
                    status={item.status}
                    index={index}
                    variant="list"
                    amount={item.meta}
                    details={item.details}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {summary.agents?.length ? (
            <div className="agent-summary-section overflow-hidden rounded-card border border-line">
              <div className="border-b border-line px-2.5 py-2 text-[11px] font-medium text-ink-2">
                子代理工作樹 · {summary.agents.filter((agent) => agent.status === 'done').length}/{summary.agents.length} 完成
              </div>
              <div className="space-y-1 px-2.5 py-2">
                {summary.agents.map((agent) => (
                  <div key={agent.id} className="flex items-start gap-2 text-[11px]">
                    <Icon
                      name={agent.status === 'done' ? 'check_circle' : agent.status === 'error' ? 'cancel' : agent.status === 'active' ? 'progress_activity' : 'radio_button_unchecked'}
                      size={14}
                      className={agent.status === 'done' ? 'text-green' : agent.status === 'error' ? 'text-red' : agent.status === 'active' ? 'animate-spin text-accent-ink' : 'text-ink-3'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-2">{agent.name}</span>
                      <span className="ml-1 text-ink-3">· {agent.role}</span>
                      {agent.model ? <span className="ml-1 text-ink-3 font-mono">· {agent.model}</span> : null}
                      {agent.lastMessage ? <span className="mt-0.5 block truncate text-ink-3">{agent.lastMessage}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <RunChangedFilesCard files={summary.files} reviewSnapshotRef={summary.reviewSnapshotRef} additions={additions} removals={removals} />
    </>
  )
}
