import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ConfidenceRing } from '../components/ConfidenceRing'
import { ReportModal } from '../components/ReportModal'
import { useAgentStore } from '../store/agentStore'

export function SuccessPage() {
  const navigate = useNavigate()
  const { agent, reset, draftInput, showReport, setShowReport } = useAgentStore()

  const downloadReport = () => {
    const content = agent.result || JSON.stringify(agent, null, 2)
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.id || 'report'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const restartSession = async () => {
    const input = draftInput || agent.objective
    const loopType = agent.loopConfig.loopType || 'Goal-based'
    reset()
    if (!input) {
      navigate('/')
      return
    }
    navigate('/')
    const { runTask } = await import('../agent/taskRunCoordinator')
    await runTask({
      sourceKind: 'retry',
      objective: input,
      title: '重新開始',
      loopType,
      eventPreMatched: loopType === 'Proactive',
      sourceLabel: '成功頁重新開始',
      meta: { eventTrigger: agent.eventTrigger },
    })
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-16 relative overflow-y-auto">
      <div className="relative z-10 flex flex-col items-center gap-6 max-w-3xl w-full">
        <div className="flex h-14 w-14 items-center justify-center text-primary">
          <Icon name="check_circle" size={32} className="text-primary" filled />
        </div>

        <div className="text-center">
          <h1 className="font-[family-name:var(--font-sora)] text-4xl font-bold text-on-surface tracking-tight mb-3">
            執行成功
          </h1>
          <p className="text-on-surface-variant text-lg max-w-xl mx-auto">
            代理執行已成功完成。所有子任務皆已解決，並以高信心度驗證。
          </p>
        </div>

        {(agent.loadedCapabilityIds?.length ?? 0) > 0 && (
          <div className="w-full flex flex-wrap justify-center gap-1.5">
            {agent.loadedCapabilityIds.map((id) => (
              <span
                key={id}
                className="px-2 py-0.5 rounded-md text-[10px] font-[family-name:var(--font-mono)] border border-primary/25 bg-primary/10 text-primary"
              >
                {id}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 w-full mt-4">
          <div className="glass-panel rounded-xl p-6 flex items-center justify-center">
            <ConfidenceRing value={agent.confidence || 0.98} label="信心度" />
          </div>

          <div className="glass-panel rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">執行步驟</h2>
              {agent.id && (
                <span className="border border-primary/30 text-primary text-xs font-[family-name:var(--font-mono)] px-2 py-1 rounded">
                  ID: {agent.id.slice(0, 12)}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {agent.steps.map((step) => (
                <div
                  key={step.step}
                  className="bg-surface-container-low/80 rounded-lg p-3 border border-white/5 flex gap-3"
                >
                  <Icon name="check_circle" size={20} className="text-primary shrink-0 mt-0.5" filled />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-sm">
                        {step.description}
                        {step.assignedAgent && (
                          <span className="text-outline font-normal"> · {step.assignedAgent}</span>
                        )}
                      </span>
                      {step.durationMs != null && (
                        <span className="text-xs text-outline font-[family-name:var(--font-mono)] shrink-0">
                          {(step.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    {step.modelUsed && (
                      <p
                        className={`text-[10px] font-[family-name:var(--font-mono)] mt-0.5 ${
                          step.modelSource === 'fallback' ? 'text-amber-300/90' : 'text-primary/80'
                        }`}
                      >
                        model: {step.modelUsed}
                        {step.modelSource === 'fallback'
                          ? ' · 全域退回'
                          : step.modelSource === 'role'
                            ? ' · 角色'
                            : step.modelSource === 'cli'
                              ? ' · CLI'
                              : ''}
                      </p>
                    )}
                    {step.result && (
                      <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">
                        {step.result}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          <button
            type="button"
            onClick={() => void restartSession()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-white/15 text-on-surface hover:bg-white/5 font-semibold text-xs tracking-wider"
          >
            <Icon name="refresh" size={16} />
            重新開始工作階段
          </button>
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 font-semibold text-xs tracking-wider"
          >
            <Icon name="description" size={16} />
            開啟報告
          </button>
          <button
            type="button"
            onClick={downloadReport}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-container text-on-primary-container hover:brightness-110 font-semibold text-xs tracking-wider glow-accent"
          >
            <Icon name="download" size={16} />
            下載報告
          </button>
          <button
            type="button"
            onClick={() => navigate('/knowledge')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-white/15 text-on-surface-variant hover:text-primary font-semibold text-xs tracking-wider"
          >
            <Icon name="hub" size={16} />
            知識圖譜
          </button>
          <button
            type="button"
            onClick={() => {
              reset()
              navigate('/')
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-on-surface-variant hover:text-primary font-semibold text-xs tracking-wider"
          >
            新目標
          </button>
        </div>
      </div>

      <ReportModal agent={agent} open={showReport} onClose={() => setShowReport(false)} />
    </div>
  )
}
