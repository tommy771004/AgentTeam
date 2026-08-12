import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ThreadRunSummary } from '../store/threadStore'
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
export function RunSummaryCard({ summary }: { summary: ThreadRunSummary }) {
  const navigate = useNavigate()
  // Context is visible at a glance; details remain one click away.
  const [open, setOpen] = useState(false)
  const [openOperation, setOpenOperation] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const groups = groupProcessOperations(summary.operations)
  const additions = summary.files.reduce((total, file) => total + (file.added || 0), 0)
  const removals = summary.files.reduce((total, file) => total + (file.removed || 0), 0)
  const label = summary.files.length
    ? `已變更 ${summary.files.length} 個檔案`
    : `執行過程 · ${summary.operations.length} 項`

  return (
    <section data-testid="run-summary-card" className="agent-summary-card w-full overflow-hidden rounded-xl border border-white/8 bg-surface-container/35">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="agent-summary-header flex w-full items-center gap-2 px-3.5 py-3 text-left"
      >
        <Icon name={summary.files.length ? 'note_stack' : 'terminal'} size={18} className="shrink-0 text-on-surface-variant" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-on-surface">{label}</span>
          <span className="block text-[11px] text-outline">
            {summary.operations.length} 項操作
            {summary.durationMs ? ` · ${Math.round(summary.durationMs / 1000)} 秒` : ''}
          </span>
        </span>
        {(additions > 0 || removals > 0) ? (
          <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)] tabular-nums">
            {additions > 0 ? <span className="text-primary">+{additions}</span> : null}
            {removals > 0 ? <span className="ml-1 text-error">−{removals}</span> : null}
          </span>
        ) : null}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="shrink-0 text-outline" />
      </button>

      {summary.subDesign ? (
        <div className="border-t border-white/8 bg-primary/[0.04] px-3.5 py-3 text-[11px] text-on-surface-variant">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
              <Icon name="palette" size={14} className="shrink-0 text-primary" />
              <span>SubDesign · {summary.subDesign.stage}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/subdesign/${summary.subDesign?.briefId}`)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/25 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Icon name="open_in_new" size={13} />查看設計
            </button>
          </div>
          <div className="mt-1 text-outline">brief {summary.subDesign.briefId}{summary.subDesign.selectedDirectionId ? ` · direction ${summary.subDesign.selectedDirectionId}` : ' · 尚未選定 direction'}{summary.subDesign.designSystemId ? ` · system ${summary.subDesign.designSystemId}` : ''}</div>
          {summary.subDesign.critique ? <div className="mt-1 text-outline">critique r{summary.subDesign.critique.revision} · {summary.subDesign.critique.verdict} · {summary.subDesign.critique.blockerCount} blockers</div> : null}
          {summary.subDesign.exports?.length ? <div className="mt-1 text-outline">exports · {summary.subDesign.exports.map((item) => `${item.format.toUpperCase()} r${item.revision}`).join(' · ')}</div> : null}
        </div>
      ) : null}

      {open ? (
        <div className="agent-summary-content max-h-[420px] space-y-3 overflow-y-auto border-t border-white/8 px-3.5 py-3 custom-scrollbar">
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
                        className="agent-summary-row flex max-w-full items-center gap-1.5 text-left text-[12px] text-on-surface-variant"
                        onClick={() => setOpenOperation((id) => (id === group.id ? null : group.id))}
                      >
                        <Icon name="folder_open" size={15} className="shrink-0 opacity-80" />
                        <span className="truncate">已蒐集上下文</span>
                        <span className="truncate text-[11px] text-outline">{contextSummary(group.operations)}</span>
                        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 opacity-50" />
                      </button>
                      <Reveal open={expanded}>
                        <pre className="agent-summary-detail ml-5 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-[11px] text-on-surface-variant/80 font-[family-name:var(--font-mono)] custom-scrollbar">
                          {group.operations.map((operation) => operation.detail || operation.title).join('\n')}
                        </pre>
                      </Reveal>
                    </div>
                  )
                }
                const operation = group.operation
                return (
                  <div key={group.id} style={enter}>
                    <button
                      type="button"
                      className={`agent-summary-row flex max-w-full items-center gap-1.5 text-left text-[12px] ${
                        operation.ok === false ? 'text-error' : 'text-on-surface-variant'
                      }`}
                      onClick={() => setOpenOperation((id) => (id === group.id ? null : group.id))}
                    >
                      <Icon name={iconFor(operation.kind)} size={15} className="shrink-0 opacity-80" />
                      <span className="truncate">{operation.title}</span>
                      {(operation.detail || operation.path) ? <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 opacity-50" /> : null}
                    </button>
                    <Reveal open={expanded && Boolean(operation.detail || operation.path)}>
                      <pre className="agent-summary-detail ml-5 mt-1 whitespace-pre-wrap break-all text-[11px] text-on-surface-variant/80 font-[family-name:var(--font-mono)]">
                        {operation.path && operation.path !== operation.detail ? `${operation.path}\n` : ''}{operation.detail}
                      </pre>
                    </Reveal>
                  </div>
                )
              })}
            </div>
          ) : null}

          {summary.plan?.length ? (
            <div className="agent-summary-section overflow-hidden rounded-xl border border-white/8">
              <div className="border-b border-white/8 px-2.5 py-2 text-[11px] font-medium text-on-surface-variant">
                任務計畫 · {summary.plan.filter((item) => item.status === 'done').length}/{summary.plan.length}
              </div>
              <div className="space-y-1 px-2.5 py-2">
                {summary.plan.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-[11px]">
                    <Icon
                      name={item.status === 'done' ? 'check_circle' : item.status === 'failed' ? 'cancel' : item.status === 'active' ? 'progress_activity' : 'radio_button_unchecked'}
                      size={14}
                      className={item.status === 'done' ? 'text-primary' : item.status === 'failed' ? 'text-error' : item.status === 'active' ? 'animate-spin text-primary' : 'text-outline'}
                    />
                    <span className={item.status === 'done' ? 'text-on-surface-variant line-through opacity-70' : 'text-on-surface-variant'}>
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {summary.agents?.length ? (
            <div className="agent-summary-section overflow-hidden rounded-xl border border-white/8">
              <div className="border-b border-white/8 px-2.5 py-2 text-[11px] font-medium text-on-surface-variant">
                子代理工作樹 · {summary.agents.filter((agent) => agent.status === 'done').length}/{summary.agents.length} 完成
              </div>
              <div className="space-y-1 px-2.5 py-2">
                {summary.agents.map((agent) => (
                  <div key={agent.id} className="flex items-start gap-2 text-[11px]">
                    <Icon
                      name={agent.status === 'done' ? 'check_circle' : agent.status === 'error' ? 'cancel' : agent.status === 'active' ? 'progress_activity' : 'radio_button_unchecked'}
                      size={14}
                      className={agent.status === 'done' ? 'text-primary' : agent.status === 'error' ? 'text-error' : agent.status === 'active' ? 'animate-spin text-primary' : 'text-outline'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-on-surface-variant">{agent.name}</span>
                      <span className="ml-1 text-outline">· {agent.role}</span>
                      {agent.model ? <span className="ml-1 text-outline font-mono">· {agent.model}</span> : null}
                      {agent.lastMessage ? <span className="mt-0.5 block truncate text-outline">{agent.lastMessage}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {summary.files.length ? (
            <div className="agent-summary-section overflow-hidden rounded-xl border border-white/8">
              <div className="border-b border-white/8 px-2.5 py-2 text-[11px] font-medium text-on-surface-variant">變更檔案</div>
              {summary.files.map((file) => (
                <div key={file.path} className="flex items-center gap-2 border-b border-white/5 px-2.5 py-1.5 last:border-0">
                  <Icon name={file.action === 'create' ? 'note_add' : 'edit'} size={14} className="shrink-0 text-outline" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-on-surface font-[family-name:var(--font-mono)]" title={file.path}>{file.path.replace(/\\/g, '/')}</span>
                  <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)]">
                    {file.added != null ? <span className="text-primary">+{file.added}</span> : null}
                    {file.removed != null ? <span className="ml-1 text-error">-{file.removed}</span> : null}
                  </span>
                </div>
              ))}
              </div>
            ) : null}

          {summary.diff !== undefined ? (
            <div data-testid="run-summary-diff" className="agent-summary-diff overflow-hidden rounded-xl border border-primary/15 bg-black/10">
              <button
                type="button"
                aria-expanded={diffOpen}
                onClick={() => setDiffOpen((value) => !value)}
                className="agent-summary-diff-header flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] font-medium text-on-surface-variant"
              >
                <Icon name="difference" size={15} className="shrink-0 text-primary" />
                <span className="flex-1">檢視 Git Diff</span>
                <Icon name={diffOpen ? 'expand_less' : 'expand_more'} size={15} className="shrink-0 text-outline" />
              </button>
              {diffOpen ? (
                <pre data-testid="run-summary-diff-content" className="max-h-[360px] overflow-auto border-t border-white/8 px-2.5 py-2 text-[11px] leading-relaxed text-on-surface-variant font-[family-name:var(--font-mono)] custom-scrollbar">
                  {summary.diff || '沒有偵測到工作樹變更。'}
                </pre>
              ) : null}
            </div>
          ) : (
            <div data-testid="run-summary-diff-empty" className="agent-summary-diff overflow-hidden rounded-xl border border-primary/15 bg-black/10">
              <div className="flex items-center gap-2 px-2.5 py-2 text-left text-[11px] font-medium text-on-surface-variant">
                <Icon name="difference" size={15} className="shrink-0 text-primary" />
                <span className="flex-1">檢視 Git Diff</span>
                <span className="text-outline">沒有偵測到工作樹變更</span>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
