import { useState } from 'react'
import type { ThreadRunSummary } from '../store/threadStore'
import { Icon } from './Icon'

function iconFor(kind: string) {
  if (kind === 'file') return 'edit'
  if (kind === 'error') return 'error'
  if (kind === 'done') return 'check_circle'
  return 'terminal'
}

/** Persisted, collapsible record of what an agent did for one answer. */
export function RunSummaryCard({ summary }: { summary: ThreadRunSummary }) {
  // Default expanded so process is visible without an extra click
  const [open, setOpen] = useState(true)
  const [openOperation, setOpenOperation] = useState<string | null>(null)
  const additions = summary.files.reduce((total, file) => total + (file.added || 0), 0)
  const removals = summary.files.reduce((total, file) => total + (file.removed || 0), 0)
  const label = summary.files.length
    ? `已變更 ${summary.files.length} 個檔案`
    : `執行過程 · ${summary.operations.length} 項`

  return (
    <section className="w-full overflow-hidden rounded-2xl border border-white/10 bg-surface-container/55">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.04]"
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
          <span className="shrink-0 text-[11px] font-[family-name:var(--font-mono)]">
            {additions > 0 ? <span className="text-primary">+{additions}</span> : null}
            {removals > 0 ? <span className="ml-1 text-error">-{removals}</span> : null}
          </span>
        ) : null}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="shrink-0 text-outline" />
      </button>

      {open ? (
        <div className="max-h-[420px] space-y-3 overflow-y-auto border-t border-white/8 px-3.5 py-3 custom-scrollbar">
          {summary.operations.length ? (
            <div className="space-y-1">
              {summary.operations.map((operation) => {
                const expanded = openOperation === operation.id
                return (
                  <div key={operation.id}>
                    <button
                      type="button"
                      className={`flex max-w-full items-center gap-1.5 text-left text-[12px] ${
                        operation.ok === false ? 'text-error' : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                      onClick={() => setOpenOperation((id) => (id === operation.id ? null : operation.id))}
                    >
                      <Icon name={iconFor(operation.kind)} size={15} className="shrink-0 opacity-80" />
                      <span className="truncate">{operation.title}</span>
                      {(operation.detail || operation.path) ? <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 opacity-50" /> : null}
                    </button>
                    {expanded && (operation.detail || operation.path) ? (
                      <pre className="ml-5 mt-1 whitespace-pre-wrap break-all rounded bg-black/15 p-2 text-[11px] text-on-surface-variant/80 font-[family-name:var(--font-mono)]">
                        {operation.path && operation.path !== operation.detail ? `${operation.path}\n` : ''}{operation.detail}
                      </pre>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {summary.files.length ? (
            <div className="overflow-hidden rounded-xl border border-white/8">
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
        </div>
      ) : null}
    </section>
  )
}
