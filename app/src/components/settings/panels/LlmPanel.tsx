import { useState } from 'react'
import { API_PROVIDER_PRESETS, apiProviderPreset } from '../../../agent/apiProviders'
import type { ApiProviderPreset, LlmSettings } from '../../../agent/types'
import { reopenFirstRunWizard } from '../../FirstRunWizard'
import {
  SettingsGroup,
  SettingsStack,
  SettingsToggle,
  settingsBtnCls,
  settingsBtnPrimaryCls,
  settingsInputCls,
} from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 語言模型節（連線、模型探索、能力探針）。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function LlmPanel({
  settings,
  set,
  fieldCtx,
  testConnection,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
  testConnection: () => Promise<{ ok: boolean; message: string }>
}) {
  const { t } = useTranslation()
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [verifyingModel, setVerifyingModel] = useState(false)
  const [modelVerifyMsg, setModelVerifyMsg] = useState('')

  const onTest = async () => {
    setTesting(true)
    setTestMsg(null)
    const r = await testConnection()
    setTestMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`)
    setTesting(false)
  }

  return (
    <>
          <SettingsGroup title={t('settings.llm.9abf79')}>
            <SettingsField id="llm.apiProvider" ctx={fieldCtx}>
              <select
                value={settings.apiProvider || 'custom'}
                className={settingsInputCls}
                onChange={(e) => {
                  const provider = apiProviderPreset(e.target.value as ApiProviderPreset)
                  if (provider.id === 'custom') {
                    set({ apiProvider: 'custom' })
                    return
                  }
                  set({
                    apiProvider: provider.id,
                    baseUrl: provider.baseUrl,
                    model: provider.defaultModel,
                    fallbackModels: provider.fallbackModels,
                    discoveredModels: [],
                  })
                }}
              >
                {API_PROVIDER_PRESETS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-outline">
                {apiProviderPreset(settings.apiProvider || 'custom').note}
              </p>
            </SettingsField>
            <SettingsField
              id="llm.enabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.enabled}
                  onChange={(v) => set({ enabled: v })}
                />
              }
            />
            <SettingsField id="llm.baseUrl" ctx={fieldCtx}>
              <input
                value={settings.baseUrl}
                onChange={(e) => set({ baseUrl: e.target.value })}
                className={settingsInputCls}
                placeholder="https://api.openai.com/v1"
              />
            </SettingsField>
            <SettingsField id="llm.apiKey" ctx={fieldCtx}>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                className={settingsInputCls}
                placeholder="sk-..."
                autoComplete="off"
              />
            </SettingsField>
            <SettingsField id="llm.model" ctx={fieldCtx}>
              <input
                list="discovered-models"
                value={settings.model}
                onChange={(e) => set({ model: e.target.value })}
                className={settingsInputCls}
                placeholder={t('settings.llm.52baa8')}
              />
              <datalist id="discovered-models">
                {(settings.discoveredModels || []).map((id) => <option key={id} value={id} />)}
              </datalist>
              {(settings.discoveredModels || []).length > 0 && (
                <p className="mt-1 text-[11px] text-outline">已從 /models 自動帶入 {settings.discoveredModels.length} 個模型。</p>
              )}
              {/* P1-B: capability profile — 已驗證 / 推測 / 未知 */}
              {(() => {
                const p = settings.modelProfiles?.[settings.model || '']
                const badge = p
                  ? p.source === 'verified'
                    ? t('settings.llm.8d9d79')
                    : t('settings.llm.26fb0d')
                  : t('settings.llm.d9c32a')
                const cap = (v: boolean | undefined, name: string) =>
                  `${name} ${v === true ? '✓' : v === false ? '✗' : '?'}`
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`px-1.5 py-0.5 rounded font-semibold ${
                        badge === t('settings.llm.8d9d79')
                          ? 'bg-primary/15 text-primary'
                          : badge === t('settings.llm.26fb0d')
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-white/10 text-outline'
                      }`}
                    >
                      {badge}
                    </span>
                    {p && (
                      <span className="text-on-surface-variant font-[family-name:var(--font-mono)]">
                        {cap(p.tools, 'tools')} · {cap(p.vision, 'vision')} ·{' '}
                        {cap(p.structuredOutput, 'json')}
                        {p.contextWindow ? ` · ${Math.round(p.contextWindow / 1000)}k ctx` : ''}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={verifyingModel || !settings.model || !settings.apiKey}
                      className={`${settingsBtnCls} disabled:opacity-50`}
                      onClick={async () => {
                        const id = settings.model?.trim()
                        if (!id) return
                        setVerifyingModel(true)
                        try {
                          const { verifyModelCapabilities } = await import(
                            '../../../agent/modelProfile'
                          )
                          const r = await verifyModelCapabilities(settings, id)
                          await set({
                            modelProfiles: {
                              ...(settings.modelProfiles || {}),
                              [id]: r.profile,
                            },
                          })
                          setModelVerifyMsg(r.logs.join(' · '))
                        } catch (e) {
                          setModelVerifyMsg(e instanceof Error ? e.message : String(e))
                        } finally {
                          setVerifyingModel(false)
                        }
                      }}
                    >
                      {verifyingModel ? t('settings.llm.d8ef9b') : t('settings.llm.d65214')}
                    </button>
                    {modelVerifyMsg && (
                      <span className="text-outline">{modelVerifyMsg}</span>
                    )}
                  </div>
                )
              })()}
            </SettingsField>
            <SettingsStack title={t('settings.llm.f78cec')}>
              <input
                value={(settings.fallbackModels || []).join(', ')}
                onChange={(e) =>
                  set({
                    fallbackModels: e.target.value
                      .split(',')
                      .map((id) => id.trim())
                      .filter(Boolean),
                  })
                }
                className={settingsInputCls}
                placeholder={t('settings.llm.b1bcea')}
              />
              <p className="mt-1 text-[11px] text-outline">
                {t('settings.llm.e7645e')}
              </p>
              {settings.apiProvider === 'aihubmix' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {apiProviderPreset('aihubmix').fallbackModels.map((model) => (
                    <button
                      key={model}
                      type="button"
                      className="rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/15"
                      onClick={() => set({ model })}
                    >
                      改用 {model}
                    </button>
                  ))}
                </div>
              )}
            </SettingsStack>
          </SettingsGroup>
          <div className="flex flex-wrap gap-2 items-center px-0.5">
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={testing}
              className={settingsBtnPrimaryCls + ' disabled:opacity-50'}
            >
              {testing ? t('settings.llm.58b883') : t('settings.llm.48b807')}
            </button>
            <button
              type="button"
              onClick={() => reopenFirstRunWizard()}
              className={settingsBtnCls}
              title={t('settings.llm.3e8e76')}
            >
              {t('settings.llm.651e6e')}
            </button>
            {testMsg && (
              <span
                className={`text-[12px] font-[family-name:var(--font-mono)] ${
                  testMsg.startsWith('✓') ? 'text-primary' : 'text-error'
                }`}
              >
                {testMsg}
              </span>
            )}
          </div>
    </>
  )
}
