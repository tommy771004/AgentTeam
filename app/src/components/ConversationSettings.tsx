import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import {
  THINKING_DEPTHS,
  type ThinkingDepth,
  getThinkingDepth,
} from '../agent/thinking'
import { modelsFromCliProviders } from '../agent/cliProviders'
import { PRIMARY_AGENTS, getPrimaryAgent } from '../agent/opencode/agents'
import type { AgentMode, CliProviderConfig } from '../agent/types'

/**
 * 對話設定：OpenCode Build/Plan + 模型 + 思考深度
 * 模型列表僅來自已啟用+授權的 CLI，無硬編碼 catalog
 */
export function ConversationSettings({
  model,
  depth,
  agentMode = 'build',
  globalModel,
  cliProviders,
  onModelChange,
  onDepthChange,
  onAgentModeChange,
  compact,
}: {
  model: string
  depth: ThinkingDepth
  agentMode?: AgentMode
  /** Fallback when model empty */
  globalModel: string
  cliProviders?: CliProviderConfig[]
  onModelChange: (model: string) => void
  onDepthChange: (d: ThinkingDepth) => void
  onAgentModeChange?: (m: AgentMode) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const effective = model.trim() || globalModel
  const depthDef = getThinkingDepth(depth)
  const agent = getPrimaryAgent(agentMode)
  const discoveredModels = useMemo(
    () => modelsFromCliProviders(cliProviders),
    [cliProviders],
  )

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* OpenCode Build / Plan */}
        {onAgentModeChange && (
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-container border border-white/10">
            {PRIMARY_AGENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={`${a.description}（Tab 切換）`}
                onClick={() => onAgentModeChange(a.id)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide transition-colors ${
                  agentMode === a.id
                    ? a.color
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-1.5 min-w-0">
          <Icon name="smart_toy" size={14} className="text-primary shrink-0" />
          <input
            list="model-presets"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder={globalModel || '模型 id…'}
            className="bg-surface-container border border-white/10 rounded-lg px-2 py-1 text-[11px] font-[family-name:var(--font-mono)] outline-none focus:border-primary/40 min-w-[120px] max-w-[200px]"
            title="此對話使用的模型（空白=全域設定）"
          />
          <datalist id="model-presets">
            {discoveredModels.map((m) => (
              <option key={`${m.providerId}-${m.id}`} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
        </label>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-container border border-white/10">
          {THINKING_DEPTHS.map((d) => (
            <button
              key={d.id}
              type="button"
              title={d.description}
              onClick={() => onDepthChange(d.id)}
              className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                depth === d.id
                  ? 'bg-primary/20 text-primary'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {d.shortLabel}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-outline hidden lg:inline truncate max-w-[200px]">
          {agent.label} · {effective || '未設定模型'} · {depthDef.label}
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-surface-container/50 p-3 space-y-3">
      <button
        type="button"
        className="w-full flex items-center justify-between text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <Icon name="tune" size={16} className="text-primary" />
          對話設定
        </span>
        <span className="text-[11px] text-outline font-[family-name:var(--font-mono)]">
          {effective || '未設定'} · {depthDef.label}
          <Icon name={open ? 'expand_less' : 'expand_more'} size={16} className="inline ml-1" />
        </span>
      </button>
      {open && (
        <>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-outline font-semibold">
              模型
            </label>
            <input
              list="model-presets-full"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={`空白則用全域：${globalModel || '未設定'}`}
              className="mt-1 w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-[family-name:var(--font-mono)] outline-none focus:border-primary/40"
            />
            <datalist id="model-presets-full">
              {discoveredModels.map((m) => (
                <option key={`${m.providerId}-${m.id}`} value={m.id}>
                  {m.label} ({m.providerName})
                </option>
              ))}
            </datalist>
            <p className="mt-1 text-[10px] text-outline">
              {discoveredModels.length
                ? `來自已授權 CLI（${discoveredModels.length} 個）；亦可手輸 model id。`
                : '尚無已授權模型；請到設定授權 CLI，或手輸 model id。'}
            </p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-outline font-semibold">
              思考深度
            </label>
            <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {THINKING_DEPTHS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onDepthChange(d.id)}
                  className={`text-left rounded-xl border px-2.5 py-2 transition-colors ${
                    depth === d.id
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-white/10 hover:border-white/20 text-on-surface-variant'
                  }`}
                >
                  <div className="text-xs font-semibold">{d.label}</div>
                  <div className="text-[10px] opacity-80 mt-0.5 leading-snug">{d.description}</div>
                  <div className="text-[9px] font-[family-name:var(--font-mono)] mt-1 opacity-60">
                    iter≤{d.maxIterations} · tools≤{d.maxToolRounds}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
