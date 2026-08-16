import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ThreadRunSummary } from '../store/threadStore'
import { deriveRunLifecycle, lifecycleToneClass } from '../agent/runLifecycle'
import { ContextCards } from './ContextCards'
import { DodScorecard } from './DodScorecard'
import { Icon } from './Icon'
import { Reveal } from './primitives/Reveal'
import { contextSummary, groupProcessOperations } from '../lib/runPresentation'

function iconFor(kind: string) {
  if (kind === 'file') return 'edit'
  if (kind === 'error') return 'error'
  if (kind === 'done') return 'check_circle'
  return 'terminal'
}

/** Persisted, collapsible record of what an agent did for one answer. */
export function RunSummaryCard({ summary, threadId }: { summary: ThreadRunSummary; threadId?: string }) {
  const navigate = useNavigate()
  // Context is visible at a glance; details remain one click away.
  const [open, setOpen] = useState(false)
  const [openOperation, setOpenOperation] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const handleExport = async (format: 'md' | 'html') => {
    setExporting(true)
    setExportMsg(null)
    try {
      const [{ useAgentStore }, { useThreadStore }, { useProjectStore }, { listJournal }, { collectReportSource, exportRunReport }] =
        await Promise.all([
          import('../store/agentStore'),
          import('../store/threadStore'),
          import('../store/projectStore'),
          import('../agent/runJournal'),
          import('../agent/reportExport'),
        ])
      const threadSummaries: Record<string, ThreadRunSummary | undefined> = {}
      for (const thread of useThreadStore.getState().threads) {
        const runBubble = [...thread.bubbles].reverse().find((b) => b.role === 'run' && b.runSummary)
        if (runBubble?.runSummary) threadSummaries[thread.id] = runBubble.runSummary
      }
      const bundle = collectReportSource({
        runId: summary.runId,
        threadId,
        journal: listJournal(),
        archive: useAgentStore.getState().archive,
        threadSummaries,
      })
      const result = await exportRunReport({
        bundle,
        format,
        projectRoot: useProjectStore.getState().root || undefined,
      })
      setExportMsg(result.message)
    } catch (e) {
      setExportMsg(`匯出失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }
  const groups = groupProcessOperations(summary.operations)
  const additions = summary.files.reduce((total, file) => total + (file.added || 0), 0)
  const removals = summary.files.reduce((total, file) => total + (file.removed || 0), 0)
  const lifecycle = deriveRunLifecycle({
    status: summary.status || 'idle',
    terminal: Boolean(summary.status),
  })
  const outcome = summary.status ? lifecycle.label : ''
  const label = summary.files.length
    ? `已變更 ${summary.files.length} 個檔案`
    : `執行過程 · ${summary.operations.length} 項`

  return (
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
          </span>
        </span>
        {summary.simulated ? (
          <span
            title="本 run 以本地模擬策略執行（未使用語言模型）"
            className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100"
          >
            模擬執行
          </span>
        ) : null}
        {outcome ? (
          <span className={`shrink-0 text-[11px] font-medium ${lifecycleToneClass(lifecycle.tone)}`}>
            {outcome}
          </span>
        ) : null}
        {(additions > 0 || removals > 0) ? (
          <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)] tabular-nums">
            {additions > 0 ? <span className="text-green">+{additions}</span> : null}
            {removals > 0 ? <span className="ml-1 text-red">−{removals}</span> : null}
          </span>
        ) : null}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="shrink-0 text-ink-3" />
      </button>

      <DodScorecard verdicts={summary.dodVerdicts} runnerKind={summary.runnerKind} />

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
          <div className="mt-1 text-ink-3">brief {summary.subDesign.briefId}{summary.subDesign.selectedDirectionId ? ` · direction ${summary.subDesign.selectedDirectionId}` : ' · 尚未選定 direction'}{summary.subDesign.designSystemId ? ` · system ${summary.subDesign.designSystemId}` : ''}</div>
          {summary.subDesign.critique ? <div className="mt-1 text-ink-3">critique r{summary.subDesign.critique.revision} · {summary.subDesign.critique.verdict} · {summary.subDesign.critique.blockerCount} blockers</div> : null}
          {summary.subDesign.exports?.length ? <div className="mt-1 text-ink-3">exports · {summary.subDesign.exports.map((item) => `${item.format.toUpperCase()} r${item.revision}`).join(' · ')}</div> : null}
        </div>
      ) : null}

      {open ? (
          <div className="agent-summary-content max-h-[420px] space-y-3 overflow-y-auto border-t border-line px-3.5 py-3 custom-scrollbar">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold tracking-widest text-ink-3">報告</span>
            <button
              type="button"
              className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-hover-2"
              onClick={() => void handleExport('md')}
            >
              匯出 Markdown
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-hover-2"
              onClick={() => void handleExport('html')}
            >
              匯出 HTML
            </button>
            {exporting ? <span className="text-[11px] text-ink-3">匯出中…</span> : null}
            {exportMsg ? <span className="text-[11px] text-ink-3">{exportMsg}</span> : null}
          </div>
          {groups.length ? (
            <div className="agent-summary-trace space-y-1">
              {groups.map((group, index) => {
                const expanded = openOperation === group.id
                const enter = {
                  animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index, 8) * 40}ms both`,
                }
                if (group.type === 'context') {
                  return (
                    <div key={group.id} style={enter}>
                      <button
                        type="button"
                        className="agent-summary-row flex max-w-full items-center gap-2 text-left text-[12px] text-ink-2"
                        onClick={() => setOpenOperation((id) => (id === group.id ? null : group.id))}
                      >
                        <Icon name="folder_open" size={15} className="shrink-0 opacity-80" />
                        <span className="truncate">已蒐集上下文</span>
                        <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px]">{contextSummary(group.operations)}</span>
                        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" />
                      </button>
                      <Reveal open={expanded}>
                        <ContextCards operations={group.operations} />
                      </Reveal>
                    </div>
                  )
                }
                const operation = group.operation
                return (
                  <div key={group.id} style={enter}>
                    <button
                      type="button"
                      className={`agent-summary-row flex max-w-full items-center gap-2 text-left text-[12px] ${
                        operation.ok === false ? 'text-red' : 'text-ink-2'
                      }`}
                      onClick={() => setOpenOperation((id) => (id === group.id ? null : group.id))}
                    >
                      <Icon name={iconFor(operation.kind)} size={15} className="shrink-0 opacity-80" />
                      <span className="shrink-0 font-medium">{operation.title}</span>
                      {(operation.detail || operation.path) ? <span className="agent-process-chip inline-flex min-w-0 flex-1 truncate px-1.5 py-0.5 text-[11.5px] font-[family-name:var(--font-mono)]">{operation.path || operation.detail}</span> : null}
                      {(operation.detail || operation.path) ? <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-ink-3" /> : null}
                    </button>
                    <Reveal open={expanded && Boolean(operation.detail || operation.path)}>
                      <pre className="agent-summary-detail ml-5 mt-1 whitespace-pre-wrap break-all text-[11px] text-ink-2 font-[family-name:var(--font-mono)]">
                        {operation.path && operation.path !== operation.detail ? `${operation.path}\n` : ''}{operation.detail}
                      </pre>
                    </Reveal>
                  </div>
                )
              })}
            </div>
          ) : null}

          {summary.plan?.length ? (
            <div className="agent-summary-section overflow-hidden rounded-card border border-line">
              <div className="border-b border-line px-2.5 py-2 text-[11px] font-medium text-ink-2">
                任務計畫 · {summary.plan.filter((item) => item.status === 'done').length}/{summary.plan.length}
              </div>
              <div className="space-y-1 px-2.5 py-2">
                {summary.plan.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-[11px]">
                    <Icon
                      name={item.status === 'done' ? 'check_circle' : item.status === 'failed' ? 'cancel' : item.status === 'active' ? 'progress_activity' : 'radio_button_unchecked'}
                      size={14}
                      className={item.status === 'done' ? 'text-green' : item.status === 'failed' ? 'text-red' : item.status === 'active' ? 'animate-spin text-accent-ink' : 'text-ink-3'}
                    />
                    <span className={item.status === 'done' ? 'text-ink-2 line-through opacity-70' : 'text-ink-2'}>
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
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

          {summary.files.length ? (
            <div className="agent-summary-section overflow-hidden rounded-card border border-line">
              <div className="border-b border-line px-2.5 py-2 text-[11px] font-medium text-ink-2">變更檔案</div>
              {summary.files.map((file) => (
                <div key={file.path} className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-0">
                  <Icon name={file.action === 'create' ? 'note_add' : 'edit'} size={14} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink font-[family-name:var(--font-mono)]" title={file.path}>{file.path.replace(/\\/g, '/')}</span>
                  <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)]">
                    {file.added != null ? <span className="text-green">+{file.added}</span> : null}
                    {file.removed != null ? <span className="ml-1 text-red">-{file.removed}</span> : null}
                  </span>
                </div>
              ))}
              </div>
            ) : null}

          {summary.diff !== undefined ? (
            <div data-testid="run-summary-diff" className="agent-summary-diff overflow-hidden rounded-card border border-line bg-inset">
              <button
                type="button"
                aria-expanded={diffOpen}
                onClick={() => setDiffOpen((value) => !value)}
                className="agent-summary-diff-header flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] font-medium text-ink-2"
              >
                <Icon name="difference" size={15} className="shrink-0 text-accent-ink" />
                <span className="flex-1">檢視 Git Diff</span>
                <Icon name={diffOpen ? 'expand_less' : 'expand_more'} size={15} className="shrink-0 text-ink-3" />
              </button>
              {diffOpen ? (
                <pre data-testid="run-summary-diff-content" className="max-h-[360px] overflow-auto border-t border-line px-2.5 py-2 text-[11px] leading-relaxed text-ink-2 font-[family-name:var(--font-mono)] custom-scrollbar">
                  {summary.diff || '沒有偵測到工作樹變更。'}
                </pre>
              ) : null}
            </div>
          ) : (
            <div data-testid="run-summary-diff-empty" className="agent-summary-diff overflow-hidden rounded-card border border-line bg-inset">
              <div className="flex items-center gap-2 px-2.5 py-2 text-left text-[11px] font-medium text-ink-2">
                <Icon name="difference" size={15} className="shrink-0 text-accent-ink" />
                <span className="flex-1">檢視 Git Diff</span>
                <span className="text-ink-3">沒有偵測到工作樹變更</span>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
