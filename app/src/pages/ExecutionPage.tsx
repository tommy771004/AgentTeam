import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { LogViewer } from '../components/LogViewer'
import { StepTimeline } from '../components/StepTimeline'
import { InterventionPanel } from '../components/InterventionPanel'
import { useAgentStore } from '../store/agentStore'
import { loopTypeZh } from '../i18n/zh'

export function ExecutionPage() {
  const navigate = useNavigate()
  const {
    agent,
    isRunning,
    activeRunIds,
    stopExecution,
    continueTurn,
    resolveIntervention,
  } = useAgentStore()
  const runId = activeRunIds[0] || null

  useEffect(() => {
    if (agent.status === 'success') {
      const t = setTimeout(() => navigate('/success'), 600)
      return () => clearTimeout(t)
    }
    if (agent.status === 'failed' || agent.status === 'halted') {
      const t = setTimeout(() => navigate('/failed'), 600)
      return () => clearTimeout(t)
    }
    if (agent.status === 'idle' && !isRunning) {
      navigate('/')
    }
  }, [agent.status, isRunning, navigate])

  const live =
    agent.status === 'running' ||
    agent.status === 'parsing' ||
    agent.status === 'manual_intervention'

  return (
    <div className="h-full flex flex-col bg-background text-on-background overflow-hidden">
      <header className="relative z-50 w-full border-b border-line bg-surface drag-region shrink-0">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4 pl-16 md:pl-0">
            <button
              type="button"
              onClick={() => {
                if (runId) stopExecution(runId)
                navigate('/')
              }}
              className="no-drag w-8 h-8 rounded-control flex items-center justify-center hover:bg-hover-2 text-on-surface-variant transition-colors group"
            >
              <Icon
                name="arrow_back"
                size={20}
                className="group-hover:-translate-x-0.5 transition-transform"
              />
            </button>
            <div className="flex flex-col no-drag">
              <span className="font-semibold text-[10px] tracking-widest text-on-surface-variant uppercase">
                目標執行 · {loopTypeZh(agent.loopConfig.loopType)}
                {agent.status === 'manual_intervention' ? ' · 人工介入' : ''}
              </span>
              <h1 className="font-semibold text-[16px] leading-tight flex items-center gap-2 text-on-surface">
                {agent.objective || '啟動中…'}
                {live && (
                  <span className="flex h-2 w-2 relative ml-1">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                )}
              </h1>
            </div>
          </div>
          <div className="no-drag flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/knowledge')}
              className="flex items-center gap-1 px-3 py-2 rounded-control border border-line text-on-surface-variant hover:text-primary hover:border-line-strong text-xs font-semibold tracking-wider uppercase"
            >
              <Icon name="hub" size={16} />
              知識圖譜
            </button>
            <button
              type="button"
              onClick={() => navigate('/records?tab=logs')}
              className="flex items-center gap-1 px-3 py-2 rounded-control border border-line text-on-surface-variant hover:text-primary hover:border-line-strong text-xs font-semibold tracking-wider uppercase"
            >
              <Icon name="terminal" size={16} />
              Logs
            </button>
            <button
              type="button"
              onClick={() => runId && stopExecution(runId)}
              className="flex items-center gap-2 px-4 py-2 rounded-control border border-error/30 bg-error/10 text-error hover:bg-error/15 hover:border-error/50 transition-colors font-semibold text-xs tracking-wider uppercase"
            >
              <Icon name="stop_circle" size={16} />
              停止執行
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 p-6 lg:p-10 w-full max-w-[1440px] mx-auto overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0">
          <div className="lg:col-span-4 flex flex-col gap-4 min-h-0 overflow-y-auto custom-scrollbar">
            <div className="glass-panel rounded-xl p-5 flex flex-col gap-3 shrink-0">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <Icon name="target" size={20} filled />
                  <span className="font-semibold text-[10px] tracking-widest uppercase">
                    主要目標
                  </span>
                </div>
                {agent.id && (
                  <span className="bg-surface-bright px-2 py-1 rounded text-on-surface-variant font-[family-name:var(--font-mono)] text-[12px] border border-outline/20">
                    ID: {agent.id.slice(0, 10)}
                  </span>
                )}
              </div>
              <p className="text-[15px] text-on-surface leading-relaxed">{agent.objective}</p>
              <div className="mt-1">
                <div className="flex justify-between text-on-surface-variant mb-2">
                  <span className="font-semibold text-[10px] tracking-widest uppercase">
                    整體進度
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[13px] text-primary">
                    {agent.progress}%
                  </span>
                </div>
                <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                    style={{ width: `${agent.progress}%` }}
                  />
                </div>
              </div>
              <div className="text-xs text-on-surface-variant font-[family-name:var(--font-mono)]">
                迭代 {agent.currentIteration}/{agent.loopConfig.maxIterations} · min conf{' '}
                {agent.minConfidence.toFixed(2)}
              </div>
              {(agent.loadedCapabilityIds?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {agent.loadedCapabilityIds.map((id) => (
                    <span
                      key={id}
                      className="px-2 py-0.5 rounded-md text-[10px] font-[family-name:var(--font-mono)] border border-line text-primary"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-panel rounded-xl p-5 flex-1 min-h-0">
              <h3 className="font-[family-name:var(--font-sora)] font-semibold text-on-surface mb-4">
                執行序列
              </h3>
              <StepTimeline steps={agent.steps} />
            </div>
          </div>

          <div className="lg:col-span-8 flex flex-col gap-4 min-h-0">
            <div className="glass-panel rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <Icon name="terminal" size={18} />
                  <span className="font-semibold text-[10px] tracking-widest uppercase">
                    子系統程序日誌
                  </span>
                </div>
                {live && (
                  <span className="flex items-center gap-1.5 text-primary text-[10px] font-semibold tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    即時串流
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <LogViewer logs={agent.logs} live={live} />
              </div>
            </div>

            {agent.toolCalls.length > 0 && (
              <div className="glass-panel rounded-xl p-4 shrink-0 max-h-40 overflow-y-auto custom-scrollbar">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-[10px] tracking-widest text-on-surface-variant uppercase">
                    工具呼叫（{agent.toolCalls.length})
                  </span>
                  <Icon name="build" size={16} className="text-outline" />
                </div>
                <div className="space-y-1.5">
                  {agent.toolCalls.slice(-8).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-start gap-2 text-[12px] font-[family-name:var(--font-mono)]"
                    >
                      <span className={t.ok ? 'text-primary' : 'text-error'}>
                        {t.ok ? '✓' : '✗'}
                      </span>
                      <span className="text-secondary shrink-0">{t.tool}</span>
                      <span className="text-outline truncate">
                        step {t.step} · {t.durationMs}ms · {t.output.slice(0, 80)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
              <div className="glass-panel rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-[10px] tracking-widest text-on-surface-variant uppercase">
                    子代理拓撲
                  </span>
                  <Icon name="hub" size={16} className="text-outline" />
                </div>
                <div className="flex items-center justify-center gap-6 py-2">
                  {agent.subAgents.map((a) => (
                    <div key={a.id} className="flex flex-col items-center gap-1 max-w-[96px]">
                      <div
                        className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${
                          a.status === 'active'
                            ? 'border-primary'
                            : a.status === 'done'
                              ? 'border-primary/40 text-primary'
                              : a.status === 'error'
                                ? 'border-error text-error'
                                : 'border-outline-variant text-outline'
                        }`}
                      >
                        <Icon
                          name={
                            a.role === 'orchestrator'
                              ? 'settings_account_box'
                              : a.role === 'analyst'
                                ? 'psychology'
                                : a.role === 'synthesizer'
                                  ? 'edit_note'
                                  : 'smart_toy'
                          }
                          size={22}
                          className={a.status === 'active' ? 'text-primary' : ''}
                        />
                      </div>
                      <span className="text-xs text-on-surface-variant">{a.name}</span>
                      <span
                        className={`text-[9px] font-[family-name:var(--font-mono)] text-center truncate w-full px-0.5 ${
                          a.modelSource === 'fallback'
                            ? 'text-amber-300/90'
                            : a.modelSource === 'role' || a.modelSource === 'cli'
                              ? 'text-primary/80'
                              : 'text-outline'
                        }`}
                        title={
                          a.model
                            ? `${a.model}${a.modelSource === 'fallback' ? ' (退回全域)' : a.modelSource === 'role' ? ' (角色)' : ''}`
                            : '未解析 model'
                        }
                      >
                        {a.model
                          ? a.model.length > 14
                            ? a.model.slice(0, 12) + '…'
                            : a.model
                          : '—'}
                      </span>
                    </div>
                  ))}
                  {agent.subAgents.length === 0 && (
                    <span className="text-sm text-outline">等待生成…</span>
                  )}
                </div>
              </div>

              <div className="glass-panel rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-[10px] tracking-widest text-on-surface-variant uppercase">
                    模型信心度
                  </span>
                  <span
                    className={`text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded ${
                      agent.confidence >= 0.9
                        ? 'bg-primary/20 text-primary'
                        : agent.confidence >= agent.minConfidence
                          ? 'bg-secondary/20 text-secondary'
                          : 'bg-error/20 text-error'
                    }`}
                  >
                    {agent.confidence >= 0.9
                      ? '最佳'
                      : agent.confidence >= agent.minConfidence
                        ? '正常'
                        : '偏低'}
                  </span>
                </div>
                <div className="flex items-end gap-2">
                  <span className="font-[family-name:var(--font-sora)] text-4xl font-bold text-primary glow-text">
                    {(agent.confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">
                  門檻：{(agent.minConfidence * 100).toFixed(0)}.0% · Entities:{' '}
                  {agent.knowledge.entities.length}
                </p>
                <div className="mt-3 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, agent.confidence * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {agent.status === 'awaiting_user' && (
              <div className="glass-panel rounded-xl p-4 border border-secondary/30 flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-secondary text-sm">等待使用者確認</p>
                  <p className="text-sm text-on-surface-variant">
                    回合制模式需明確確認後才會結束。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => runId && continueTurn(runId)}
                  className="bg-primary-container text-on-primary-container px-4 py-2 rounded font-semibold text-xs tracking-wider uppercase hover:brightness-110 shrink-0"
                >
                  確認 / ACK
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      <InterventionPanel
        intervention={agent.intervention}
        onApprove={(payloadJson) =>
          runId && resolveIntervention({ action: 'approve', payloadJson }, runId)
        }
        onReject={() => runId && resolveIntervention({ action: 'reject' }, runId)}
      />
    </div>
  )
}
