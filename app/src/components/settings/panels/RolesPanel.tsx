import { useMemo, useState } from 'react'
import {
  parseDeployOutboundGuard,
  type OutboundGuardMode,
} from '../../../agent/outbound/outboundGate'
import { connectionIdForBuiltinLlm } from '../../../agent/outbound/providerConnectionId'
import { parsePolicySourceMode } from '../../../agent/outbound/policySourceMode'
import { modelsGroupedByCliProvider } from '../../../agent/cliProviders'
import type { LlmSettings } from '../../../agent/types'
import {
  type OutboundStatus,
  PillSelect,
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  SettingsToggle,
  settingsBtnCls,
  settingsInputCls,
} from '../SettingsChrome'
import { SettingsAnchor, SettingsField, type SettingsFieldContext } from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 角色模型節（角色指派、Delegate Personas、出站資料閘門）。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function RolesPanel({
  settings,
  set,
  fieldCtx,
  outboundStatus,
  onNavigateSection,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
  outboundStatus: OutboundStatus | null
  /** 導向另一個設定節（例如「前往 CLI 授權」） */
  onNavigateSection: (sectionId: string) => void
}) {
  const { t } = useTranslation()
  const [classifierTestMsg, setClassifierTestMsg] = useState<string | null>(null)
  const [classifierTesting, setClassifierTesting] = useState(false)
  const [personaDraft, setPersonaDraft] = useState({ name: '', instructions: '', model: '' })

  const roleModelGroups = useMemo(
    () => modelsGroupedByCliProvider(settings.cliProviders),
    [settings.cliProviders],
  )

  const allRoleModelIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of roleModelGroups) {
      for (const m of g.models) ids.add(m.id)
    }
    if (settings.model?.trim()) ids.add(settings.model.trim())
    for (const id of settings.discoveredModels || []) ids.add(id)
    return ids
  }, [roleModelGroups, settings.model, settings.discoveredModels])
  const suggestedRoleModels = useMemo(() => {
    const available = roleModelGroups.flatMap((group) => group.models)
    const rank = (model: (typeof available)[number], preferred: 'strong' | 'fast') => {
      const depths = model.depths || []
      const score = preferred === 'strong'
        ? (depths.includes('ultra') ? 5 : depths.includes('max') ? 4 : depths.includes('deep') ? 3 : depths.includes('standard') ? 2 : 1)
        : (depths.includes('fast') ? 5 : depths.includes('standard') ? 3 : 1)
      return score
    }
    const strongest = [...available].sort((a, b) => rank(b, 'strong') - rank(a, 'strong'))[0]?.id || settings.model || settings.discoveredModels?.[0] || ''
    const fastest = [...available].sort((a, b) => rank(b, 'fast') - rank(a, 'fast'))[0]?.id || strongest
    return { orchestrator: strongest, synthesizer: strongest, analyst: fastest, executor: fastest }
  }, [roleModelGroups, settings.model, settings.discoveredModels])
  const setRoleModel = (
    role: keyof NonNullable<LlmSettings['roleModels']>,
    value: string,
  ) => {
    set({
      roleModels: {
        orchestrator: settings.roleModels?.orchestrator || '',
        analyst: settings.roleModels?.analyst || '',
        synthesizer: settings.roleModels?.synthesizer || '',
        executor: settings.roleModels?.executor || '',
        [role]: value,
      },
    })
  }

  return (
    <>
          <SettingsAnchor id="roles.roleModels" ctx={fieldCtx}>
          <SettingsGroup
            title={t('settings.roles.79c884')}
            action={
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-outline">{roleModelGroups.length ? `${roleModelGroups.length} 個 CLI · ${allRoleModelIds.size} 模型` : t('settings.roles.f880e0')}</span>
                <button type="button" className={settingsBtnCls} onClick={() => set({ roleModels: suggestedRoleModels })} disabled={!suggestedRoleModels.orchestrator}>{t('settings.roles.ad0837')}</button>
              </div>
            }
          >
            <SettingsField
              id="roles.subAgentsEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.subAgentsEnabled === true}
                  onChange={(v) => set({ subAgentsEnabled: v })}
                />
              }
            />
            <SettingsAnchor id="roles.outboundProtectionEnabled" ctx={fieldCtx}>
            {(() => {
              // Outbound Data Gate (deploy × user). Build flavor is orthogonal.
              let deploy: OutboundGuardMode = settings.outboundGuardDeploy || 'off'
              if (!settings.outboundGuardDeploy) {
                try {
                  deploy = parseDeployOutboundGuard(
                    typeof process !== 'undefined'
                      ? (process as { env?: Record<string, string | undefined> }).env
                          ?.SUBAGENTS_OUTBOUND_GUARD
                      : undefined,
                  )
                } catch {
                  deploy = 'off'
                }
              }
              const connId = connectionIdForBuiltinLlm({
                apiProvider: settings.apiProvider,
                baseUrl: settings.baseUrl,
              })
              let policySourceLabel = 'local'
              try {
                policySourceLabel = parsePolicySourceMode(
                  typeof process !== 'undefined'
                    ? (process as { env?: Record<string, string | undefined> }).env
                        ?.SUBAGENTS_POLICY_SOURCE
                    : undefined,
                )
              } catch {
                policySourceLabel = 'invalid'
              }
              const deployLive = (outboundStatus?.deployGuard as OutboundGuardMode) || deploy
              const sourceLive = outboundStatus?.policySource || policySourceLabel
              const flavor = outboundStatus?.buildFlavor || 'standard'
              const policyMeta = `provider ${outboundStatus?.connectionId || connId} · source ${sourceLive} · flavor ${flavor}${outboundStatus?.encryptionAvailable ? ' · sealed-capable' : ''}`
              const extraStatus =
                outboundStatus?.deployGuardError ||
                outboundStatus?.policyDir
                  ? ` · dir ${outboundStatus.policyDir || '—'}`
                  : ''
              if (deployLive === 'off') {
                return (
                  <>
                    <SettingsRow
                      title={t('settings.roles.bbac0c')}
                      description={`部署模式 off：LLM／CLI 出站不經淨化（維持既有路徑）。${policyMeta}${extraStatus}`}
                      control={<span className="text-[11px] text-outline">off</span>}
                    />
                    <SettingsRow
                      title="Build flavor"
                      description={t('settings.roles.59a8b0')}
                      control={<span className="text-[11px] text-outline">{flavor}</span>}
                    />
                  </>
                )
              }
              if (deployLive === 'required') {
                return (
                  <>
                    <SettingsRow
                      title={t('settings.roles.9d7ecc')}
                      description={`required：公司部署強制保護，使用者無法關閉。所有 builtin LLM 與 external CLI 出站都會經過閘門。${policyMeta}${extraStatus}`}
                      control={
                        <span className="text-[11px] text-outline" title={t('settings.roles.23c78b')}>
                          {t('settings.roles.b60850')}
                        </span>
                      }
                    />
                    <SettingsRow
                      title="Build flavor"
                      description={t('settings.roles.59a8b0')}
                      control={<span className="text-[11px] text-outline">{flavor}</span>}
                    />
                  </>
                )
              }
              if (deployLive === 'demo') {
                return (
                  <>
                    <SettingsRow
                      title={t('settings.roles.f0033a')}
                      description={`⚠ demo 非企業保障：會跑淨化流程與暫時證據，不可當作公司合規驗證。${policyMeta}${extraStatus}`}
                      control={<span className="text-[11px] text-amber-400">demo</span>}
                    />
                    <SettingsRow
                      title="Build flavor"
                      description={t('settings.roles.59a8b0')}
                      control={<span className="text-[11px] text-outline">{flavor}</span>}
                    />
                  </>
                )
              }
              return (
                <>
                  <SettingsRow
                    title={t('settings.roles.bbac0c')}
                    description={`optional：可自行開啟保護。啟用後每次 LLM／CLI 出站都會經過閘門（可即時套用，無需重啟）。${policyMeta}${extraStatus}`}
                    control={
                      <SettingsToggle
                        checked={settings.outboundProtectionEnabled === true}
                        onChange={(v) => set({ outboundProtectionEnabled: v })}
                      />
                    }
                  />
                  <SettingsRow
                    title="Build flavor"
                    description={t('settings.roles.59a8b0')}
                    control={<span className="text-[11px] text-outline">{flavor}</span>}
                  />
                </>
              )
            })()}
            </SettingsAnchor>
            {/* 可見性由 registry 的 visibility: 'policyAdminBuild' 決定（fieldCtx 帶入） */}
            <SettingsField
              id="roles.policyAdminBuild"
              ctx={fieldCtx}
              description={t('settings.roles.3b3b3a')}
              control={<span className="text-[11px] text-primary">enabled</span>}
            />
            <SettingsField
              id="roles.classificationEndpointUrl"
              ctx={fieldCtx}
              control={
                <input
                  className={settingsInputCls + ' min-w-[14rem]'}
                  value={settings.classificationEndpointUrl || ''}
                  placeholder="https://classify.corp.example/v1"
                  onChange={(e) => set({ classificationEndpointUrl: e.target.value })}
                />
              }
            />
            <SettingsField
              id="roles.classificationAllowPlaintextHttp"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.classificationAllowPlaintextHttp === true}
                  onChange={(v) => set({ classificationAllowPlaintextHttp: v })}
                />
              }
            />
            <SettingsRow
              title={t('settings.roles.2b840e')}
              description={classifierTestMsg || t('settings.roles.9c38df')}
              control={
                <button
                  type="button"
                  className={settingsBtnCls}
                  disabled={classifierTesting || !(settings.classificationEndpointUrl || '').trim()}
                  onClick={() => {
                    void (async () => {
                      setClassifierTesting(true)
                      setClassifierTestMsg(null)
                      try {
                        const { callCompanyClassifier, syntheticClassifierTestRequest } =
                          await import('../../../agent/outbound/companyClassifier')
                        const { connectionIdForBuiltinLlm: connFn } = await import(
                          '../../../agent/outbound/providerConnectionId'
                        )
                        const cid = connFn({
                          apiProvider: settings.apiProvider,
                          baseUrl: settings.baseUrl,
                        })
                        const url = (settings.classificationEndpointUrl || '').trim()
                        const r = await callCompanyClassifier({
                          endpointUrl: url,
                          request: syntheticClassifierTestRequest(cid),
                          allowPlaintextHttp: settings.classificationAllowPlaintextHttp === true,
                        })
                        if (r.ok) {
                          setClassifierTestMsg(
                            `OK · ${r.transport} · attempts=${r.attempts} · exclusions=${r.exclusions.length}`,
                          )
                        } else {
                          setClassifierTestMsg(`${r.status}: ${r.reason}`)
                        }
                      } catch (e) {
                        setClassifierTestMsg(e instanceof Error ? e.message : String(e))
                      } finally {
                        setClassifierTesting(false)
                      }
                    })()
                  }}
                >
                  {classifierTesting ? t('settings.roles.58b883') : t('settings.roles.8b2da2')}
                </button>
              }
            />
            {(
              [
                ['orchestrator', t('settings.roles.6a8e43')],
                ['analyst', t('settings.roles.3571dd')],
                ['synthesizer', t('settings.roles.8ed013')],
                ['executor', t('settings.roles.0e65fb')],
              ] as const
            ).map(([key, label]) => {
              const current = settings.roleModels?.[key] || ''
              const orphan =
                current && !allRoleModelIds.has(current) ? current : null
              return (
                <SettingsRow
                  key={key}
                  title={label}
                  description={t('settings.roles.eea333')}
                  control={
                    <PillSelect
                      value={current}
                      onChange={(v) => setRoleModel(key, v)}
                      className="min-w-[11rem]"
                    >
                      <option value="">
                        全域預設
                        {settings.model ? `（${settings.model}）` : ''}
                      </option>
                      {settings.model?.trim() ? (
                        <optgroup label={t('settings.roles.b07e92')}>
                          <option value={settings.model.trim()}>
                            {settings.model.trim()}
                          </option>
                        </optgroup>
                      ) : null}
                      {(settings.discoveredModels || []).length ? (
                        <optgroup label={t('settings.roles.56b1fa')}>
                          {settings.discoveredModels.map((id) => <option key={`api-${id}`} value={id}>{id}</option>)}
                        </optgroup>
                      ) : null}
                      {roleModelGroups.map((g) => (
                        <optgroup
                          key={g.providerId}
                          label={`${g.providerName}（${g.kind}）`}
                        >
                          {g.models.map((m) => (
                            <option key={`${g.providerId}-${m.id}`} value={m.id}>
                              {m.label || m.id}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      {orphan ? (
                        <optgroup label={t('settings.roles.ea4241')}>
                          <option value={orphan}>{orphan}</option>
                        </optgroup>
                      ) : null}
                    </PillSelect>
                  }
                />
              )
            })}
          </SettingsGroup>
          </SettingsAnchor>
          {!roleModelGroups.length && (
            <p className="text-[12px] text-outline px-1 leading-relaxed">
              尚無可選模型。請先到{' '}
              <button
                type="button"
                className="text-primary font-semibold hover:underline"
                onClick={() => onNavigateSection('cli')}
              >
                {t('settings.roles.0c6edc')}
              </button>{' '}
              啟用並「一鍵偵測本機 CLI 並匯入模型」，或到語言模型填寫預設 model。
            </p>
          )}
          <SettingsGroup title={t('settings.roles.d8d54e')}>
            {Object.entries(settings.delegatePersonas || {}).map(([name, p]) => (
              <SettingsRow
                key={name}
                title={name}
                description={`${p.model ? `model=${p.model} · ` : ''}${(p.description || p.instructions || '').slice(0, 80)}`}
                control={
                  <button
                    type="button"
                    className="text-[11px] text-error hover:underline"
                    onClick={() => {
                      const next = { ...(settings.delegatePersonas || {}) }
                      delete next[name]
                      set({ delegatePersonas: next })
                    }}
                  >
                    {t('settings.roles.a48f5d')}
                  </button>
                }
              />
            ))}
            <SettingsStack title={t('settings.roles.15a059')}>
              <div className="space-y-1.5">
                <input
                  value={personaDraft.name}
                  onChange={(e) => setPersonaDraft({ ...personaDraft, name: e.target.value })}
                  placeholder={t('settings.roles.e9b225')}
                  className={settingsInputCls + ' w-full'}
                />
                <textarea
                  value={personaDraft.instructions}
                  onChange={(e) =>
                    setPersonaDraft({ ...personaDraft, instructions: e.target.value })
                  }
                  placeholder={t('settings.roles.525021')}
                  rows={3}
                  className={settingsInputCls + ' w-full'}
                />
                <div className="flex items-center gap-2">
                  <input
                    value={personaDraft.model}
                    onChange={(e) => setPersonaDraft({ ...personaDraft, model: e.target.value })}
                    placeholder={t('settings.roles.2c762c')}
                    className={settingsInputCls + ' flex-1'}
                  />
                  <button
                    type="button"
                    className={settingsBtnCls}
                    disabled={!personaDraft.name.trim() || !personaDraft.instructions.trim()}
                    onClick={() => {
                      const name = personaDraft.name.trim().slice(0, 40)
                      set({
                        delegatePersonas: {
                          ...(settings.delegatePersonas || {}),
                          [name]: {
                            instructions: personaDraft.instructions.trim().slice(0, 2000),
                            model: personaDraft.model.trim() || undefined,
                          },
                        },
                      })
                      setPersonaDraft({ name: '', instructions: '', model: '' })
                    }}
                  >
                    {t('settings.roles.2cd9e6')}
                  </button>
                </div>
                <p className="text-[11px] text-outline">
                  {t('settings.roles.ee2de3')}
                </p>
              </div>
            </SettingsStack>
          </SettingsGroup>
    </>
  )
}
