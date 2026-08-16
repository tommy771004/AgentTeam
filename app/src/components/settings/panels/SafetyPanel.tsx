import { useMemo, useState } from 'react'
import { APPROVAL_MODE_DEFS } from '../../../agent/approvalModes'
import { recommendToolTuning } from '../../../agent/modelTuning'
import { BUILTIN_CAPABILITIES } from '../../../agent/capabilities'
import { skillsStore } from '../../../agent/hermes/skills'
import { customToolsForSettings } from '../../../agent/tools/customTools'
import type { LlmSettings } from '../../../agent/types'
import { useProjectStore } from '../../../store/projectStore'
import { Icon } from '../../Icon'
import {
  SettingsRow,
  SettingsToggle,
  settingsBtnCls,
  settingsInputCls,
} from '../SettingsChrome'
import {
  SettingsField,
  SettingsGroupFor,
  type SettingsFieldContext,
} from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 組態節（核准與沙盒、門檻、LLM 韌性、專案 Hooks 信任）。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function SafetyPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const { t } = useTranslation()
  const projectRoot = useProjectStore((s) => s.root)
  const [hookRulesDraft, setHookRulesDraft] = useState('')
  const [hookRulesError, setHookRulesError] = useState<string | null>(null)
  const toolTuning = useMemo(
    () => recommendToolTuning(settings.model || settings.roleModels?.orchestrator || ''),
    [settings.model, settings.roleModels?.orchestrator],
  )

  return (
    <>
          <SettingsGroupFor section="safety" group={t('settings.safety.f607d1')} ctx={fieldCtx}>
            <SettingsField id="safety.approvalMode" ctx={fieldCtx}>
              <div className="space-y-1.5">
                {APPROVAL_MODE_DEFS.map((d) => {
                  const selected = (settings.approvalMode || 'auto') === d.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => set({ approvalMode: d.id })}
                      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                        selected
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-white/10 hover:border-white/25'
                      }`}
                    >
                      <Icon
                        name={d.icon}
                        size={18}
                        className={`shrink-0 mt-0.5 ${
                          d.id === 'full' ? 'text-amber-300/90' : 'text-on-surface-variant'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-on-surface">
                          {d.title}
                        </span>
                        <span className="block text-[11px] text-on-surface-variant leading-snug mt-0.5">
                          {d.desc}
                        </span>
                      </span>
                      {selected && (
                        <Icon name="check" size={16} className="shrink-0 mt-1 text-primary" />
                      )}
                    </button>
                  )
                })}
              </div>
              {(settings.approvalMode || 'auto') === 'full' && (
                <p className="text-[11px] text-amber-300/80 mt-2 leading-relaxed">
                  {t('settings.safety.cd1e01')}
                </p>
              )}
            </SettingsField>
            <SettingsField
              id="safety.safetyEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.safetyEnabled}
                  onChange={(v) => set({ safetyEnabled: v })}
                />
              }
            />
            <SettingsField
              id="safety.toolsEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.toolsEnabled !== false}
                  onChange={(v) => set({ toolsEnabled: v })}
                />
              }
            />
            <SettingsField
              id="safety.webSearchEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.webSearchEnabled !== false}
                  onChange={(v) => set({ webSearchEnabled: v })}
                />
              }
            />
            <SettingsField
              id="safety.functionCalling"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.functionCalling !== false}
                  onChange={(v) => set({ functionCalling: v })}
                />
              }
            />
            <SettingsField
              id="safety.llmParseEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.llmParseEnabled !== false}
                  onChange={(v) => set({ llmParseEnabled: v })}
                />
              }
            />
            <SettingsField
              id="safety.sessionRecallEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.sessionRecallEnabled !== false}
                  onChange={(v) => set({ sessionRecallEnabled: v })}
                />
              }
            />
            <SettingsField
              id="safety.capabilitiesEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.capabilitiesEnabled !== false}
                  onChange={(v) => set({ capabilitiesEnabled: v })}
                />
              }
            />
            {settings.capabilitiesEnabled !== false && (
              <>
                <SettingsField
                  id="safety.toolSearchEnabled"
                  ctx={fieldCtx}
                  description={`工具太多先藏起來：可見 schema 超過 ${settings.toolSearchThreshold ?? 24} 個時，模型用 tool_search 關鍵字檢索解鎖（省 context）`}
                  control={
                    <SettingsToggle
                      checked={settings.toolSearchEnabled !== false}
                      onChange={(v) => set({ toolSearchEnabled: v })}
                    />
                  }
                />
                {settings.toolSearchEnabled !== false && (
                  <SettingsField
                    id="safety.toolSearchThreshold"
                    ctx={fieldCtx}
                    control={
                      <input
                        type="number"
                        min={4}
                        max={200}
                        value={settings.toolSearchThreshold ?? 24}
                        onChange={(e) =>
                          set({
                            toolSearchThreshold: Math.max(
                              4,
                              Number(e.target.value) || 24,
                            ),
                          })
                        }
                        className="w-20 bg-surface-container border border-white/10 rounded-lg px-2 py-1 text-[13px] text-right"
                      />
                    }
                  />
                )}
                <SettingsRow
                  title={t('settings.safety.9ad62c')}
                  description={toolTuning.label}
                  control={
                    <button
                      type="button"
                      className={settingsBtnCls}
                      onClick={() =>
                        set({
                          toolSearchThreshold: toolTuning.toolSearchThreshold,
                          maxToolPayloadKb: toolTuning.maxToolPayloadKb,
                          maxToolRounds: toolTuning.maxToolRounds,
                        })
                      }
                    >
                      {t('settings.safety.ad0837')}
                    </button>
                  }
                />
                <SettingsField
                  id="safety.codeModeEnabled"
                  ctx={fieldCtx}
                  control={
                    <SettingsToggle
                      checked={settings.codeModeEnabled !== false}
                      onChange={(v) => set({ codeModeEnabled: v })}
                    />
                  }
                />
              </>
            )}
            {settings.capabilitiesEnabled !== false && (
              <SettingsField id="safety.alwaysOnCapabilities" ctx={fieldCtx}>
                <p className="text-[12px] text-on-surface-variant mb-2 leading-relaxed">
                  {t('settings.safety.1dfa4e')}
                </p>
                {(() => {
                  type CapChip = { id: string; description: string; isFixed: boolean }
                  const groups: Array<{ label: string; items: CapChip[] }> = [
                    {
                      label: t('settings.safety.f41e61'),
                      items: BUILTIN_CAPABILITIES.map((c) => ({
                        id: c.id,
                        description: c.description,
                        isFixed: c.deferLoading === false,
                      })),
                    },
                    {
                      label: 'MCP',
                      items: settings.mcpEnabled
                        ? (settings.mcpServers || [])
                            .filter((s) => s.enabled)
                            .map((s) => ({
                              id: `mcp:${s.id}`,
                              description: `MCP「${s.name}」${s.secretPluginId ? ` · secret=${s.secretPluginId}` : ''}`,
                              isFixed: false,
                            }))
                        : [],
                    },
                    {
                      label: t('settings.safety.d7f452'),
                      items: (() => {
                        const owners = new Map<string, string[]>()
                        for (const tool of customToolsForSettings(settings)) {
                          const o = tool.ownerId || 'settings'
                          owners.set(o, [...(owners.get(o) || []), tool.name])
                        }
                        return [...owners].map(([owner, names]) => ({
                          id: `user:${owner}`,
                          description: `${owner}（${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}）`,
                          isFixed: false,
                        }))
                      })(),
                    },
                    {
                      label: t('settings.safety.53da13'),
                      items: skillsStore.list().map((s) => ({
                        id: `skill:${s.meta.name}`,
                        description: s.meta.description || s.meta.name,
                        isFixed: false,
                      })),
                    },
                  ]
                  const toggle = (id: string, isFixed: boolean) => {
                    if (isFixed) return
                    const cur = new Set(settings.alwaysOnCapabilities || [])
                    if (cur.has(id)) cur.delete(id)
                    else cur.add(id)
                    set({ alwaysOnCapabilities: [...cur] })
                  }
                  return (
                    <div className="space-y-3">
                      {groups
                        .filter((g) => g.items.length > 0)
                        .map((g) => (
                          <div key={g.label}>
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-outline mb-1.5">
                              {g.label}
                              <span className="ml-1.5 normal-case font-normal opacity-70">
                                {g.items.filter(
                                  (c) =>
                                    c.isFixed ||
                                    (settings.alwaysOnCapabilities || []).includes(c.id),
                                ).length}
                                /{g.items.length} on
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {g.items.map((c) => {
                                const active =
                                  c.isFixed ||
                                  (settings.alwaysOnCapabilities || []).includes(c.id)
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    disabled={c.isFixed}
                                    title={c.description}
                                    onClick={() => toggle(c.id, c.isFixed)}
                                    className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                      active
                                        ? 'border-primary/40 bg-primary/15 text-primary'
                                        : 'border-white/10 text-on-surface-variant hover:border-white/25'
                                    } ${c.isFixed ? 'opacity-80 cursor-default' : ''}`}
                                  >
                                    {c.id.replace(/^(user|mcp|skill):/, '')}
                                    {c.isFixed ? t('settings.safety.95963a') : active ? ' · on' : ''}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      {(settings.alwaysOnCapabilities || []).length > 0 && (
                        <button
                          type="button"
                          className={settingsBtnCls}
                          onClick={() => set({ alwaysOnCapabilities: [] })}
                        >
                          {t('settings.safety.8fb187')}
                        </button>
                      )}
                    </div>
                  )
                })()}
              </SettingsField>
            )}
            {/* P1-D: declarative lifecycle hook rules */}
            <SettingsField id="safety.hookRules" ctx={fieldCtx}>
              <p className="text-[11px] text-on-surface-variant mb-1 leading-relaxed">
                {t('settings.safety.fd7452')}
              </p>
              <textarea
                className={settingsInputCls + ' min-h-[120px] resize-y font-[family-name:var(--font-mono)] text-[11px]'}
                value={hookRulesDraft || JSON.stringify(settings.hookRules || [], null, 2)}
                onChange={(e) => { setHookRulesDraft(e.target.value); setHookRulesError(null) }}
                onBlur={() => {
                  try {
                    const parsed = hookRulesDraft.trim() ? JSON.parse(hookRulesDraft) : []
                    if (!Array.isArray(parsed)) throw new Error(t('settings.safety.dc2ac2'))
                    void set({ hookRules: parsed })
                    setHookRulesDraft('')
                  } catch (err) {
                    setHookRulesError(err instanceof Error ? err.message : String(err))
                  }
                }}
                placeholder={t('settings.safety.bc35f0')}
              />
              {hookRulesError && (
                <p className="text-[11px] text-error mt-1">{hookRulesError}</p>
              )}
            </SettingsField>
            <SettingsField
              id="safety.haltOnPayloadOverflow"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.haltOnPayloadOverflow === true}
                  onChange={(v) => set({ haltOnPayloadOverflow: v })}
                />
              }
            />
          </SettingsGroupFor>
          <SettingsGroupFor section="safety" group={t('settings.safety.12aab0')} ctx={fieldCtx}>
            <SettingsField
              id="safety.authLevel"
              ctx={fieldCtx}
              description={`目前 ${settings.authLevel}（敏感表需 ≥ 4）`}
              control={
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={settings.authLevel}
                  onChange={(e) =>
                    set({ authLevel: Number(e.target.value) })
                  }
                  className="w-36 accent-primary"
                />
              }
            />
            <SettingsField
              id="safety.minConfidence"
              ctx={fieldCtx}
              description={settings.minConfidence.toFixed(2)}
              control={
                <input
                  type="range"
                  min={0.5}
                  max={0.99}
                  step={0.01}
                  value={settings.minConfidence}
                  onChange={(e) =>
                    set({ minConfidence: Number(e.target.value) })
                  }
                  className="w-36 accent-primary"
                />
              }
            />
            <SettingsField
              id="safety.maxIterationsDefault"
              ctx={fieldCtx}
              control={
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.maxIterationsDefault}
                  onChange={(e) =>
                    set({ maxIterationsDefault: Number(e.target.value) || 5,
                    })
                  }
                  className={settingsInputCls + ' w-20 text-right'}
                />
              }
            />
            <SettingsField
              id="safety.maxToolPayloadKb"
              ctx={fieldCtx}
              description={`${settings.maxToolPayloadKb ?? 50} KB`}
              control={
                <input
                  type="range"
                  min={8}
                  max={512}
                  value={settings.maxToolPayloadKb ?? 50}
                  onChange={(e) =>
                    set({ maxToolPayloadKb: Number(e.target.value) })
                  }
                  className="w-36 accent-primary"
                />
              }
            />
            <SettingsField
              id="safety.maxToolRounds"
              ctx={fieldCtx}
              control={
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.maxToolRounds ?? 4}
                  onChange={(e) =>
                    set({ maxToolRounds: Number(e.target.value) || 4 })
                  }
                  className={settingsInputCls + ' w-20 text-right'}
                />
              }
            />
          </SettingsGroupFor>
          <SettingsGroupFor section="safety" group={t('settings.safety.b75f1d')} ctx={fieldCtx}>
            <SettingsField
              id="safety.llmRetryMaxAttempts"
              ctx={fieldCtx}
              control={
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={settings.llmRetryMaxAttempts ?? 3}
                  onChange={(e) =>
                    set({
                      llmRetryMaxAttempts: Math.min(
                        6,
                        Math.max(1, Number(e.target.value) || 3),
                      ),
                    })
                  }
                  className={settingsInputCls + ' w-20 text-right'}
                />
              }
            />
            <SettingsField
              id="safety.llmCircuitBreakerEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.llmCircuitBreakerEnabled !== false}
                  onChange={(v) => set({ llmCircuitBreakerEnabled: v })}
                />
              }
            />
            <SettingsField
              id="safety.defaultContextWindowTokens"
              ctx={fieldCtx}
              description={`模型 profile 未知時的 token 上限（目前 ${settings.defaultContextWindowTokens ?? 64000}）；供壓縮門檻與溢位預檢`}
              control={
                <input
                  type="number"
                  min={4000}
                  max={2000000}
                  step={1000}
                  value={settings.defaultContextWindowTokens ?? 64000}
                  onChange={(e) =>
                    set({
                      defaultContextWindowTokens: Math.max(
                        4000,
                        Number(e.target.value) || 64000,
                      ),
                    })
                  }
                  className={settingsInputCls + ' w-28 text-right'}
                />
              }
            />
          </SettingsGroupFor>
          <SettingsGroupFor section="safety" group={t('settings.safety.5f5093')} ctx={fieldCtx}>
            <SettingsField
              id="safety.trustedHookProjects"
              ctx={fieldCtx}
              description={
                projectRoot
                  ? `允許載入 ${projectRoot} 下的 .subagents/hooks.json（僅能限制/觀察，不能放寬權限）`
                  : t('settings.safety.681b10')
              }
              control={
                <SettingsToggle
                  checked={Boolean(
                    projectRoot &&
                      (settings.trustedHookProjects || []).includes(projectRoot),
                  )}
                  onChange={(v) => {
                    if (!projectRoot) return
                    const current = settings.trustedHookProjects || []
                    set({
                      trustedHookProjects: v
                        ? [...new Set([...current, projectRoot])]
                        : current.filter((r) => r !== projectRoot),
                    })
                    void import('../../../agent/projectHooks').then((m) =>
                      m.invalidateProjectHooks(projectRoot),
                    )
                  }}
                />
              }
            />
            {(settings.trustedHookProjects || []).map((root) => (
              <SettingsRow
                key={root}
                title={root.split('/').pop() || root}
                description={root}
                control={
                  <button
                    type="button"
                    className="text-[11px] text-error hover:underline"
                    onClick={() => {
                      set({
                        trustedHookProjects: (
                          settings.trustedHookProjects || []
                        ).filter((r) => r !== root),
                      })
                      void import('../../../agent/projectHooks').then((m) =>
                        m.invalidateProjectHooks(root),
                      )
                    }}
                  >
                    {t('settings.safety.93446f')}
                  </button>
                }
              />
            ))}
          </SettingsGroupFor>
          <p className="text-[11px] text-outline px-1">
            {t('settings.safety.a8b8b9')}
          </p>
    </>
  )
}
