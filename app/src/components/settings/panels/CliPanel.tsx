import { useState } from 'react'
import type { LlmSettings } from '../../../agent/types'
import { CLI_ADAPTERS, DISCOVERY_ONLY_AGENT_ADAPTERS } from '../../../agent/cliAdapters'
import {
  SettingsGroup,
  SettingsToggle,
  settingsBtnCls,
  settingsBtnPrimaryCls,
  settingsInputCls,
} from '../SettingsChrome'
import {
  SettingsAnchor,
  SettingsField,
  SettingsGroupFor,
  type SettingsFieldContext,
} from '../SettingsField'

/**
 * Settings registry restructure（spec 3/6）— CLI 授權節（安全、adapter capability matrix、廠商矩陣）。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function CliPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const [cliMsg, setCliMsg] = useState<string | null>(null)

  return (
    <>
          <SettingsGroupFor section="cli" group="安全" ctx={fieldCtx}>
            <SettingsField
              id="cli.bashRequireAsk"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.bashRequireAsk !== false}
                  onChange={(v) => set({ bashRequireAsk: v })}
                />
              }
            />
          </SettingsGroupFor>
          <SettingsGroup title="Adapter capability matrix">
            <div className="grid gap-2 px-4 py-3 sm:grid-cols-2">
              {CLI_ADAPTERS.map((adapter) => {
                const providerId = adapter.id === 'claude' ? 'anthropic' : adapter.id === 'gemini' ? 'google' : adapter.id
                const provider = (settings.cliProviders || []).find((item) => item.id === providerId || item.id === adapter.id)
                return (
                  <div key={adapter.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-on-surface">{adapter.displayName}</span>
                      <span className={`text-[10px] ${provider?.enabled && provider.authorized ? 'text-primary' : 'text-outline'}`}>
                        {provider?.enabled && provider.authorized ? '已授權' : '未授權'}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-outline">
                      resume {adapter.supports.resume ? '✓' : '—'} · image {adapter.supports.images ? '✓' : '—'} · MCP {adapter.supports.mcp ? '✓' : '—'} · sandbox {adapter.supports.sandbox}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-outline/70">
                      probe {provider?.lastProbeAt ? new Date(provider.lastProbeAt).toLocaleString() : '尚未掃描'} · {provider?.diagnostic?.binaryPath || adapter.binaryCandidates[0]}
                    </p>
                  </div>
                )
              })}
            </div>
            <p className="px-4 pb-3 text-[11px] leading-relaxed text-outline">
              未安裝或未授權只會顯示診斷，不會自動安裝 binary 或複製 token。其他 agent 目前維持 discovery-only：{DISCOVERY_ONLY_AGENT_ADAPTERS.slice(0, 6).map((item) => item.displayName).join('、')} 等。
            </p>
          </SettingsGroup>
          <SettingsAnchor id="cli.cliProviders" ctx={fieldCtx}>
          <SettingsGroupFor section="cli" group="廠商" ctx={fieldCtx}>
            {(settings.cliProviders || []).map((p, idx) => (
              <div key={p.id} className="px-4 py-3 space-y-2 border-b border-white/[0.07] last:border-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[13px] font-medium">{p.name}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-outline">啟用</span>
                    <SettingsToggle
                      checked={p.enabled}
                      onChange={(v) => {
                        const next = [...(settings.cliProviders || [])]
                        next[idx] = { ...p, enabled: v }
                        set({ cliProviders: next })
                      }}
                    />
                    <span className="text-[11px] text-outline">已授權</span>
                    <SettingsToggle
                      checked={p.authorized}
                      onChange={(v) => {
                        const next = [...(settings.cliProviders || [])]
                        next[idx] = { ...p, authorized: v }
                        set({ cliProviders: next })
                      }}
                    />
                  </div>
                </div>
                {(p.kind === 'openai' ||
                  p.kind === 'anthropic' ||
                  p.kind === 'google' ||
                  p.kind === 'custom') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      className={settingsInputCls}
                      type="password"
                      placeholder="API Key"
                      value={p.apiKey || ''}
                      onChange={(e) => {
                        const next = [...(settings.cliProviders || [])]
                        next[idx] = {
                          ...p,
                          apiKey: e.target.value,
                          authorized: Boolean(e.target.value) || p.authorized,
                        }
                        set({ cliProviders: next })
                      }}
                    />
                    <input
                      className={settingsInputCls}
                      placeholder="Base URL"
                      value={p.baseUrl || ''}
                      onChange={(e) => {
                        const next = [...(settings.cliProviders || [])]
                        next[idx] = { ...p, baseUrl: e.target.value }
                        set({ cliProviders: next })
                      }}
                    />
                  </div>
                )}
                {(p.kind === 'opencode' ||
                  p.kind === 'cursor' ||
                  p.kind === 'codex' ||
                  p.kind === 'anthropic' ||
                  p.kind === 'google') && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      className={settingsInputCls + ' flex-1 min-w-[140px]'}
                      placeholder={`CLI 指令名，如 ${p.cliBinary || p.kind}`}
                      value={p.cliBinary || ''}
                      onChange={(e) => {
                        const next = [...(settings.cliProviders || [])]
                        next[idx] = { ...p, cliBinary: e.target.value }
                        set({ cliProviders: next })
                      }}
                    />
                    <button
                      type="button"
                      className="px-3 py-2 rounded border border-primary/40 text-primary text-xs font-semibold shrink-0"
                      onClick={async () => {
                        const bin = p.cliBinary || p.kind
                        if (!window.subagents?.cli?.which) {
                          setCliMsg('需 Electron 偵測 CLI')
                          return
                        }
                        const r = await window.subagents.cli.which(bin)
                        const next = [...(settings.cliProviders || [])]
                        next[idx] = {
                          ...p,
                          authorized: r.found,
                          enabled: r.found ? true : p.enabled,
                        }
                        set({ cliProviders: next })
                        setCliMsg(
                          r.found
                            ? `✓ ${p.name}: ${r.path}`
                            : `✗ 找不到 ${bin}（請安裝並加入 PATH）`,
                        )
                      }}
                    >
                      偵測 CLI
                    </button>
                  </div>
                )}
                <p className="text-[10px] text-outline font-[family-name:var(--font-mono)]">
                  模型：{(p.models || []).map((m) => m.id).join(', ') || '—'}
                </p>
              </div>
            ))}
          </SettingsGroupFor>
          </SettingsAnchor>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              type="button"
              className={settingsBtnPrimaryCls}
              onClick={async () => {
                if (!window.subagents?.cli?.applyDiscovery) {
                  setCliMsg('一鍵偵測需 Electron（會讀本機 ~/.codex、~/.claude、~/.grok、opencode.jsonc）')
                  return
                }
                setCliMsg('掃描本機 CLI 與設定中…')
                try {
                  const r = await window.subagents.cli.applyDiscovery(
                    (settings.cliProviders || []) as unknown[],
                  )
                  const providers = r.providers as typeof settings.cliProviders
                  const models = providers.flatMap((provider) => provider.models || [])
                  const strongest = r.suggestedModel || models[0]?.id || ''
                  const fastest = models.find((model) => model.depths?.includes('fast'))?.id || strongest
                  set({ cliProviders: r.providers as typeof settings.cliProviders,
                    ...(r.suggestedModel ? { model: r.suggestedModel } : {}),
                    ...(strongest
                      ? { roleModels: { orchestrator: strongest, synthesizer: strongest, analyst: fastest, executor: fastest } }
                      : {}),
                  })
                  setCliMsg(
                    [
                      '✓ 已匯入本機偵測結果（不會複製 OAuth/API secret）',
                      r.summary,
                      r.suggestedModel ? `建議模型：${r.suggestedModel}` : '',
                      strongest ? '已套用角色模型建議（協調/合成＝較強；分析/執行＝較快）。' : '',
                      r.suggestedDepth ? `建議推理：${r.suggestedDepth}` : '',
                      '',
                      '說明：Codex/Claude/Grok 若用訂閱登入，執行仍走各自 CLI；',
                      '本 App 內建 LLM 請求需另外設定 OpenAI 相容 API（或用 bash 呼叫 CLI）。',
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  )
                } catch (e) {
                  setCliMsg(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              一鍵偵測本機 CLI 並匯入模型
            </button>
            <button
              type="button"
              className={settingsBtnCls}
              onClick={async () => {
                if (!window.subagents?.opencode) {
                  setCliMsg('opencode 掃描需 Electron')
                  return
                }
                const d = await window.subagents.opencode.detect()
                const { useOpenCodeConfigStore } = await import('../../../store/opencodeConfigStore')
                const { useProjectStore } = await import('../../../store/projectStore')
                await useOpenCodeConfigStore
                  .getState()
                  .hydrate(useProjectStore.getState().root)
                const oc = useOpenCodeConfigStore.getState()
                const primaries = oc.agents.filter((a) => a.kind === 'primary')
                const subs = oc.agents.filter((a) => a.kind === 'subagent')
                setCliMsg(
                  [
                    d.found ? `CLI ${d.path} (${d.version || '?'})` : 'opencode CLI 未找到',
                    `config sources: ${oc.sources.length}`,
                    ...oc.sources.map((s) => `  · ${s}`),
                    `agents: primary=${primaries.length} subagent=${subs.length}`,
                    ...oc.agents
                      .filter((a) => a.source !== 'builtin')
                      .slice(0, 12)
                      .map(
                        (a) =>
                          `  · ${a.id} [${a.kind}/${a.source}] ${a.model || 'model=default'}`,
                      ),
                    oc.commands.length ? `commands: ${oc.commands.length}` : '',
                    oc.model ? `default model: ${oc.model}` : '',
                    oc.small_model ? `small_model: ${oc.small_model}` : '',
                    oc.error || '',
                  ]
                    .filter(Boolean)
                    .join('\n'),
                )
                if (d.found || oc.sources.length) {
                  const next = [...(settings.cliProviders || [])]
                  const i = next.findIndex((x) => x.id === 'opencode')
                  if (i >= 0) {
                    next[i] = { ...next[i], enabled: true, authorized: true }
                    set({ cliProviders: next })
                  }
                }
              }}
            >
              掃描 OpenCode agents
            </button>
          </div>
          {cliMsg && (
            <pre className="text-[11px] font-[family-name:var(--font-mono)] text-primary whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/[0.03] p-3 max-h-40 overflow-y-auto custom-scrollbar">
              {cliMsg}
            </pre>
          )}
    </>
  )
}
