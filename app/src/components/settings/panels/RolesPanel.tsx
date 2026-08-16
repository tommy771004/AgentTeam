import { useMemo, useState } from 'react'
import {
  parseDeployOutboundGuard,
  type OutboundGuardMode,
} from '../../../agent/outbound/outboundGate'
import { connectionIdForBuiltinLlm } from '../../../agent/outbound/providerConnectionId'
import { parsePolicySourceMode } from '../../../agent/outbound/policySourceMode'
import { modelsGroupedByCliProvider } from '../../../agent/cliProviders'
import type { LlmSettings } from '../../../agent/types'
import { Icon } from '../../Icon'
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
            title="各角色模型"
            action={
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-outline">{roleModelGroups.length ? `${roleModelGroups.length} 個 CLI · ${allRoleModelIds.size} 模型` : '尚無已授權 CLI 模型'}</span>
                <button type="button" className={settingsBtnCls} onClick={() => set({ roleModels: suggestedRoleModels })} disabled={!suggestedRoleModels.orchestrator}>套用建議</button>
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
                      title="出站資料閘門"
                      description={`部署模式 off：LLM／CLI 出站不經淨化（維持既有路徑）。${policyMeta}${extraStatus}`}
                      control={<span className="text-[11px] text-outline">off</span>}
                    />
                    <SettingsRow
                      title="Build flavor"
                      description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                      control={<span className="text-[11px] text-outline">{flavor}</span>}
                    />
                  </>
                )
              }
              if (deployLive === 'required') {
                return (
                  <>
                    <SettingsRow
                      title="出站資料閘門（公司強制）"
                      description={`required：公司部署強制保護，使用者無法關閉。所有 builtin LLM 與 external CLI 出站都會經過閘門。${policyMeta}${extraStatus}`}
                      control={
                        <span className="text-[11px] text-outline" title="公司強制 · 不可關閉">
                          公司強制 · 開
                        </span>
                      }
                    />
                    <SettingsRow
                      title="Build flavor"
                      description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                      control={<span className="text-[11px] text-outline">{flavor}</span>}
                    />
                  </>
                )
              }
              if (deployLive === 'demo') {
                return (
                  <>
                    <SettingsRow
                      title="出站資料閘門（demo）"
                      description={`⚠ demo 非企業保障：會跑淨化流程與暫時證據，不可當作公司合規驗證。${policyMeta}${extraStatus}`}
                      control={<span className="text-[11px] text-amber-400">demo</span>}
                    />
                    <SettingsRow
                      title="Build flavor"
                      description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                      control={<span className="text-[11px] text-outline">{flavor}</span>}
                    />
                  </>
                )
              }
              return (
                <>
                  <SettingsRow
                    title="出站資料閘門"
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
                    description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                    control={<span className="text-[11px] text-outline">{flavor}</span>}
                  />
                </>
              )
            })()}
            </SettingsAnchor>
            {(outboundStatus?.buildFlavor === 'policy-admin' ||
              (typeof process !== 'undefined' &&
                (process as { env?: Record<string, string | undefined> }).env
                  ?.SUBAGENTS_BUILD_FLAVOR === 'policy-admin')) && (
              <SettingsRow
                title="Policy Admin"
                description="此 build 含政策草稿／啟用／證據驗證管理面。Possession of this artifact is the management authority — 不會繞過 Outbound Data Gate。"
                control={<span className="text-[11px] text-primary">enabled</span>}
              />
            )}
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
              title="Classifier 連線測試"
              description={classifierTestMsg || '使用 synthetic payload 探測 endpoint。'}
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
                  {classifierTesting ? '測試中…' : '測試'}
                </button>
              }
            />
            {(
              [
                ['orchestrator', 'Manager／協調者'],
                ['analyst', 'Analyzer-1／分析'],
                ['synthesizer', 'Writer／合成'],
                ['executor', 'Core／執行'],
              ] as const
            ).map(([key, label]) => {
              const current = settings.roleModels?.[key] || ''
              const orphan =
                current && !allRoleModelIds.has(current) ? current : null
              return (
                <SettingsRow
                  key={key}
                  title={label}
                  description="依 CLI 類別選擇；留空＝全域預設"
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
                        <optgroup label="語言模型設定">
                          <option value={settings.model.trim()}>
                            {settings.model.trim()}
                          </option>
                        </optgroup>
                      ) : null}
                      {(settings.discoveredModels || []).length ? (
                        <optgroup label="已測試 API／models">
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
                        <optgroup label="目前值（不在清單）">
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
                CLI 授權
              </button>{' '}
              啟用並「一鍵偵測本機 CLI 並匯入模型」，或到語言模型填寫預設 model。
            </p>
          )}
          <SettingsGroup title="Delegate Personas（G9 行為疊層）">
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
                    刪除
                  </button>
                }
              />
            ))}
            <SettingsStack title="新增 persona">
              <div className="space-y-1.5">
                <input
                  value={personaDraft.name}
                  onChange={(e) => setPersonaDraft({ ...personaDraft, name: e.target.value })}
                  placeholder="名稱（如 researcher / concise）"
                  className={settingsInputCls + ' w-full'}
                />
                <textarea
                  value={personaDraft.instructions}
                  onChange={(e) =>
                    setPersonaDraft({ ...personaDraft, instructions: e.target.value })
                  }
                  placeholder="行為指示（注入子代理 prompt；如「務必引用具體檔案路徑」）"
                  rows={3}
                  className={settingsInputCls + ' w-full'}
                />
                <div className="flex items-center gap-2">
                  <input
                    value={personaDraft.model}
                    onChange={(e) => setPersonaDraft({ ...personaDraft, model: e.target.value })}
                    placeholder="模型覆寫（選填；role 覆寫優先）"
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
                    新增
                  </button>
                </div>
                <p className="text-[11px] text-outline">
                  delegate_task 以 persona=&lt;名稱&gt; 套用；只影響指示與模型，不放寬工具權限（capability_mode 另管）。
                </p>
              </div>
            </SettingsStack>
          </SettingsGroup>
    </>
  )
}
