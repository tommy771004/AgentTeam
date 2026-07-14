import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { LogViewer } from '../components/LogViewer'
import { useAgentStore } from '../store/agentStore'
import { useSettingsStore } from '../store/settingsStore'

export function FailedPage() {
  const navigate = useNavigate()
  const { agent, reset, draftInput, startExecution } = useAgentStore()
  const settings = useSettingsStore((s) => s.settings)

  const isHalted = agent.status === 'halted'
  const [maxIter, setMaxIter] = useState(
    Math.max(agent.loopConfig.maxIterations || 5, settings.maxIterationsDefault),
  )
  const [minConf, setMinConf] = useState(agent.minConfidence || settings.minConfidence || 0.8)
  const [timeoutMs, setTimeoutMs] = useState(30000)

  const restartWithOverrides = async () => {
    const input = draftInput || agent.objective
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
      title: '重試',
      loopType: agent.loopConfig.loopType || 'Goal-based',
      eventPreMatched: agent.loopConfig.loopType === 'Proactive',
      sourceLabel: '失敗頁重試',
      overrides: {
        maxIterations: maxIter,
        minConfidence: minConf,
        timeoutMs,
        eventTrigger: agent.eventTrigger,
      },
    })
  }

  return (
    <div className="min-h-full px-6 py-10 max-w-[1440px] mx-auto w-full relative">
      {/* Radial failure aura for halt aesthetic */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-40">
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-error/20" />
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full border border-error/15" />
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-error/10" />
      </div>

      <div className="relative z-10 flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-error/15 text-error text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-error" />
              {isHalted ? '狀態：已中止' : '系統錯誤'}
            </span>
          </div>
          <h1 className="font-[family-name:var(--font-sora)] text-3xl font-semibold text-on-surface mb-1">
            {isHalted ? '代理循環已中止' : '執行協議失敗'}
          </h1>
          <p className="text-on-surface-variant max-w-2xl">
            {agent.haltReason ||
              (isHalted
                ? 'Execution terminated. Maximum iteration limit reached without achieving minimum confidence threshold.'
                : '代理循環在執行期間遇到嚴重驗證錯誤。')}
          </p>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="glass-panel rounded-xl p-5 border border-error/20">
            <div className="flex items-center gap-2 text-error mb-2">
              <Icon name="error" size={22} filled />
              <h2 className="font-[family-name:var(--font-sora)] font-semibold text-lg">
                驗證失敗
              </h2>
            </div>
            <p className="text-on-surface-variant text-sm mb-4">
              {agent.haltReason ||
                '未滿足循環終止條件。代理處於無法收斂狀態。'}
            </p>
            <div className="bg-[#0b1326] border border-white/10 rounded-lg max-h-56 overflow-hidden">
              <LogViewer logs={agent.logs.slice(-20)} />
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                onClick={() => navigate('/records?tab=logs')}
                className="px-3 py-2 rounded border border-white/10 text-on-surface-variant hover:text-primary text-xs font-semibold tracking-wider uppercase"
              >
                檢視日誌
              </button>
              <button
                type="button"
                onClick={() => void restartWithOverrides()}
                className="px-3 py-2 rounded bg-primary-container text-on-primary-container text-xs font-semibold tracking-wider uppercase hover:brightness-110"
              >
                重新啟動代理
              </button>
            </div>
          </div>

          {/* 手動參數覆寫 */}
          <div className="glass-panel rounded-xl p-5 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-[family-name:var(--font-sora)] font-semibold text-lg">
                手動參數覆寫
              </h3>
              {agent.id && (
                <span className="text-[10px] tracking-widest uppercase text-outline font-[family-name:var(--font-mono)]">
                  工作階段 ID： #{agent.id.slice(0, 10)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <OverrideField
                label="最大迭代"
                icon="sync"
                hint="防止無限推理迴圈。"
              >
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxIter}
                  onChange={(e) => setMaxIter(Number(e.target.value) || 1)}
                  className="w-full bg-surface border border-white/10 rounded px-3 py-2 font-[family-name:var(--font-mono)] text-primary text-lg outline-none focus:border-primary/40"
                />
              </OverrideField>
              <OverrideField
                label="最低信心度"
                icon="tune"
                hint="任務完成門檻。"
              >
                <div className="flex flex-col gap-2">
                  <input
                    type="range"
                    min={0.5}
                    max={0.99}
                    step={0.01}
                    value={minConf}
                    onChange={(e) => setMinConf(Number(e.target.value))}
                    className="w-full accent-primary-container"
                  />
                  <span className="font-[family-name:var(--font-mono)] text-primary text-right">
                    {minConf.toFixed(2)}
                  </span>
                </div>
              </OverrideField>
              <OverrideField
                label="逾時（毫秒）"
                icon="timer"
                hint="每個節點最大執行時間。"
              >
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value) || 30000)}
                  className="w-full bg-surface border border-white/10 rounded px-3 py-2 font-[family-name:var(--font-mono)] text-on-surface text-lg outline-none focus:border-primary/40"
                />
              </OverrideField>
            </div>

            <div className="mt-4 bg-[#0b1326] border border-white/10 rounded-lg max-h-28 overflow-hidden">
              <LogViewer logs={agent.logs.slice(-6)} />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  reset()
                  navigate('/')
                }}
                className="px-4 py-2 text-xs font-semibold tracking-wider uppercase text-on-surface-variant hover:text-error"
              >
                中止工作階段
              </button>
              <button
                type="button"
                onClick={() => void restartWithOverrides()}
                className="px-4 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 text-xs font-semibold tracking-wider uppercase flex items-center gap-1"
              >
                <Icon name="refresh" size={14} />
                以覆寫參數重啟
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-panel rounded-xl p-4 border border-primary/20">
              <p className="font-semibold text-[10px] tracking-widest text-primary uppercase mb-2">
                建議模式
              </p>
              <p className="text-sm text-on-surface-variant">
                當{' '}
                <code className="text-primary">max_iterations</code> is reached, such as routing to
                a human-in-the-loop queue.
              </p>
            </div>
            <div className="glass-panel rounded-xl p-4 border border-error/20">
              <p className="font-semibold text-[10px] tracking-widest text-error uppercase mb-2 flex items-center gap-1">
                <Icon name="warning" size={14} /> 反模式
              </p>
              <p className="text-sm text-on-surface-variant">
                Allowing the loop to retry indefinitely without evaluating the delta of improvement
                between iterations.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="glass-panel rounded-xl overflow-hidden h-full min-h-[360px] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
              <h3 className="font-[family-name:var(--font-sora)] font-semibold">執行圖</h3>
              <span className="flex items-center gap-1 text-error text-xs">
                <Icon name="cancel" size={14} /> 失敗
              </span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 relative">
              <div className="w-12 h-12 rounded-xl border border-outline-variant flex items-center justify-center text-outline">
                <Icon name="play_arrow" size={24} />
              </div>
              <div className="w-px h-8 bg-outline-variant/50" />
              <div className="w-14 h-14 rounded-xl border-2 border-error/40 bg-error/5 flex items-center justify-center text-error">
                <Icon name="psychology" size={28} />
              </div>
              <div className="border border-dashed border-error/40 rounded px-3 py-1 text-error text-xs font-[family-name:var(--font-mono)]">
                Iteration {agent.currentIteration}/{agent.loopConfig.maxIterations}
              </div>
              <div className="w-px h-8 bg-outline-variant/50" />
              <div className="w-12 h-12 rounded-xl border border-error flex items-center justify-center text-error">
                <Icon name="block" size={24} />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-white/10 bg-surface-container-low/50">
              <p className="text-xs text-on-surface-variant flex items-start gap-2">
                <Icon name="info" size={16} className="text-outline shrink-0" />
                <span>
                  <strong className="text-on-surface">中止原因：</strong>{' '}
                  {agent.haltReason || '已達最大迭代'}. 請調整上方覆寫參數後重新啟動。
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OverrideField({
  label,
  icon,
  hint,
  children,
}: {
  label: string
  icon: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="bg-surface-container-low/80 rounded-lg p-3 border border-white/5">
      <div className="flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant mb-2">
        <Icon name={icon} size={12} />
        {label}
      </div>
      {children}
      <p className="text-[11px] text-outline mt-2">{hint}</p>
    </div>
  )
}
