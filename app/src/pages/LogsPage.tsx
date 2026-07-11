/** @deprecated Prefer RecordsPage tab=logs. Route redirects to /records?tab=logs. */
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { LogViewer } from '../components/LogViewer'
import { useAgentStore } from '../store/agentStore'

/**
 * Full execution log / interrupted state — matches ai_agent_loop_7 design.
 */
export function LogsPage() {
  const navigate = useNavigate()
  const { agent, reset, draftInput } = useAgentStore()

  const halted =
    agent.status === 'halted' || agent.status === 'failed' || Boolean(agent.violation)
  const exitCode = agent.violation?.exitCode ?? (halted ? 1 : 0)

  const restartAgent = async () => {
    const input = draftInput || agent.objective
    const loopType = agent.loopConfig.loopType || 'Goal-based'
    reset()
    if (!input) {
      navigate('/')
      return
    }
    navigate('/')
    const { runExternalObjective } = await import('../agent/runExternal')
    await runExternalObjective({
      objective: input,
      title: '重啟',
      loopType,
      eventPreMatched: loopType === 'Proactive',
      sourceLabel: '日誌頁重啟',
    })
  }

  const downloadLogs = () => {
    const lines = agent.logs.map(
      (l) => `[${l.timestamp}] ${l.level.padEnd(8)} ${l.message}`,
    )
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.id || 'stdout'}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyLogs = async () => {
    const text = agent.logs.map((l) => `[${l.timestamp}] ${l.level} ${l.message}`).join('\n')
    await navigator.clipboard.writeText(text)
  }

  return (
    <div className="min-h-full px-6 py-8 max-w-[1440px] mx-auto">
      <div className="glass-panel rounded-xl overflow-hidden border border-white/10 min-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-surface-container-low/60">
          <div className="flex items-center gap-3">
            <Icon name="warning" className="text-error" size={24} filled />
            <h1 className="font-[family-name:var(--font-sora)] text-xl font-semibold text-on-surface">
              {halted ? 'Execution Interrupted' : 'Execution Logs'}
            </h1>
            {halted && (
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-1 rounded bg-error/20 text-error border border-error/30">
                Exit Code {exitCode}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-outline hover:text-on-surface p-1"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0">
          {/* Left panel */}
          <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-white/10 p-5 flex flex-col gap-5">
            <div>
              <h3 className="text-[10px] font-semibold tracking-widest uppercase text-outline mb-2">
                Current Status
              </h3>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    halted ? 'bg-error' : agent.status === 'success' ? 'bg-primary' : 'bg-secondary'
                  }`}
                />
                <span className={`font-semibold ${halted ? 'text-error' : 'text-primary'}`}>
                  {halted
                    ? 'Halted'
                    : agent.status === 'success'
                      ? 'Completed'
                      : agent.status || 'Idle'}
                </span>
              </div>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {agent.haltReason ||
                  agent.violation?.detail ||
                  (agent.status === 'success'
                    ? 'Loop finished and archived successfully.'
                    : 'No critical violations recorded for this session.')}
              </p>
            </div>

            <div className="h-px bg-white/10" />

            <div>
              <h3 className="text-[10px] font-semibold tracking-widest uppercase text-outline mb-3">
                Trace Context
              </h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-outline text-xs mb-0.5">Agent ID</dt>
                  <dd className="font-[family-name:var(--font-mono)] text-primary text-xs break-all">
                    {agent.id || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-outline text-xs mb-0.5">Task Definition</dt>
                  <dd className="text-on-surface-variant text-sm">
                    &quot;{agent.objective || '—'}&quot;
                  </dd>
                </div>
                <div>
                  <dt className="text-outline text-xs mb-0.5">Timestamp</dt>
                  <dd className="font-[family-name:var(--font-mono)] text-xs text-on-surface-variant">
                    {agent.finishedAt || agent.startedAt || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-outline text-xs mb-0.5">Loop / Tools</dt>
                  <dd className="text-xs text-on-surface-variant">
                    {agent.loopConfig.loopType} · {agent.toolCalls.length} tool calls ·{' '}
                    {agent.tokensUsed} tokens
                  </dd>
                </div>
              </dl>
            </div>

            {agent.violation && (
              <>
                <div className="h-px bg-white/10" />
                <div>
                  <h3 className="text-[10px] font-semibold tracking-widest uppercase text-outline mb-2">
                    Violated Rule
                  </h3>
                  <div className="rounded-lg border border-error/30 bg-error/10 p-3">
                    <p className="font-semibold text-error text-sm mb-1">{agent.violation.code}</p>
                    <p className="text-sm text-on-surface-variant">{agent.violation.detail}</p>
                  </div>
                </div>
              </>
            )}

            <div className="mt-auto pt-4">
              <button
                type="button"
                onClick={() => void restartAgent()}
                className="w-full py-2.5 rounded-lg border border-white/15 text-xs font-semibold tracking-wider uppercase hover:border-primary/40 hover:text-primary flex items-center justify-center gap-1"
              >
                <Icon name="refresh" size={16} />
                Restart Agent
              </button>
            </div>
          </aside>

          {/* Right: stdout */}
          <section className="lg:col-span-8 flex flex-col min-h-[420px]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-surface/40">
              <span className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant flex items-center gap-1">
                <Icon name="terminal" size={16} />
                stdout.log
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => void copyLogs()}
                  className="p-1.5 rounded hover:bg-white/5 text-outline"
                  title="Copy"
                >
                  <Icon name="content_copy" size={16} />
                </button>
                <button
                  type="button"
                  onClick={downloadLogs}
                  className="p-1.5 rounded hover:bg-white/5 text-outline"
                  title="Download"
                >
                  <Icon name="download" size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-[#060e20]">
              {agent.logs.length === 0 ? (
                <p className="p-6 text-sm text-outline">No logs yet. Run an agent loop first.</p>
              ) : (
                <LogViewer logs={agent.logs} />
              )}
            </div>
            {agent.violation?.stackTrace?.length ? (
              <div className="px-4 py-3 border-t border-white/10 bg-surface-container-low/40">
                <p className="text-[10px] font-semibold tracking-widest uppercase text-outline mb-1">
                  Stack Trace
                </p>
                <pre className="font-[family-name:var(--font-mono)] text-[11px] text-error/90 whitespace-pre-wrap">
                  {agent.violation.stackTrace.join('\n')}
                </pre>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
