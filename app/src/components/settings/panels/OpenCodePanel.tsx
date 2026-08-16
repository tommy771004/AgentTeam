import { useState } from 'react'
import { mapOpenCodeProviderCatalog } from '../../../agent/opencode/providerAdapter'
import {
  getOpenCodeProviderCatalog,
  inspectOpenCodeServer,
  unwrapOpenCodeServerValue,
} from '../../../agent/opencode/serverClient'
import type { LlmSettings } from '../../../agent/types'
import { useOpenCodeConfigStore } from '../../../store/opencodeConfigStore'
import { useProjectStore } from '../../../store/projectStore'
import { getLiveSlashCommands } from '../../../commands/registry'
import {
  Row,
  SettingsGroup,
  SettingsRow,
  StatChip,
  settingsBtnCls,
} from '../SettingsChrome'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6 ticket 07）— OpenCode 節。
 *
 * 純搬移：config 路徑、專案權限、agents 註冊表、commands→slash 的流程原封不動。
 */
export function OpenCodePanel({
  settings,
  set,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
}) {
  const { t } = useTranslation()
  const oc = useOpenCodeConfigStore()
  const projectRoot = useProjectStore((s) => s.root)
  const [ocProviderMsg, setOcProviderMsg] = useState<string | null>(null)

  return (
        <div className="space-y-1 animate-macos-enter">
          <SettingsGroup
            title={t('settings.opencode.452935')}
            action={
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={oc.loading}
                  onClick={() => void oc.hydrate(projectRoot)}
                  className={settingsBtnCls + ' disabled:opacity-40'}
                >
                  {oc.loading ? t('settings.opencode.c38b87') : t('settings.opencode.5387b5')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setOcProviderMsg(t('settings.opencode.4d57cf'))
                    const health = await inspectOpenCodeServer()
                    if (!health.ok || !health.baseUrl) {
                      setOcProviderMsg(health.error || t('settings.opencode.9257ee'))
                      return
                    }
                    const raw = await getOpenCodeProviderCatalog(health.baseUrl)
                    const mapped = mapOpenCodeProviderCatalog(
                      unwrapOpenCodeServerValue(raw) as Parameters<typeof mapOpenCodeProviderCatalog>[0],
                    )
                    if (!mapped.modelIds.length) {
                      setOcProviderMsg(t('settings.opencode.eaf5c8'))
                      return
                    }
                    const existing = settings.modelProfiles || {}
                    const profiles = { ...existing }
                    for (const id of mapped.modelIds) {
                      if (!profiles[id]) profiles[id] = mapped.profiles[id]
                    }
                    set({
                      discoveredModels: [...new Set([...(settings.discoveredModels || []), ...mapped.modelIds])],
                      modelProfiles: profiles,
                    })
                    setOcProviderMsg(`已採用 ${mapped.modelIds.length} 個 server model candidate（不覆蓋既有模型設定）。`)
                  }}
                  className={settingsBtnCls}
                >
                  {t('settings.opencode.297918')}
                </button>
              </div>
            }
          >
            <div className="px-4 py-3 text-[11px] text-outline leading-relaxed">
              合併{' '}
              <code className="text-primary/80 font-mono">{t('settings.opencode.3263fb')}</code>
              {t('settings.opencode.425113')} <code className="text-primary/80 font-mono">opencode.json</code> 與{' '}
              <code className="text-primary/80 font-mono">.opencode/agents|commands</code>
              {t('settings.opencode.142fa5')}
            </div>
            <div className="grid grid-cols-2 gap-2 px-4 pb-3">
              <StatChip label={t('settings.opencode.7ee19b')} value={String(oc.sources.length)} />
              <StatChip label="Agents" value={String(oc.agents.length)} />
              <StatChip label="Commands" value={String(oc.commands.length)} />
              <StatChip
                label={t('settings.opencode.1bd60f')}
                value={String(getLiveSlashCommands().length)}
              />
            </div>
            {oc.model && <Row k="default model" v={oc.model} mono />}
            {oc.small_model && <Row k="small_model" v={oc.small_model} mono />}
            {oc.default_agent && <Row k="default_agent" v={oc.default_agent} mono />}
            {oc.error && (
              <p className="text-[11px] text-amber-200/90 px-4 pb-3">{oc.error}</p>
            )}
            {ocProviderMsg && (
              <p className="text-[11px] text-primary/90 px-4 pb-3">{ocProviderMsg}</p>
            )}
          </SettingsGroup>

          <SettingsGroup title={t('settings.opencode.717118')}>
            {oc.sources.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-outline">
                {t('settings.opencode.0b4237')}
              </div>
            ) : (
              oc.sources.map((s) => (
                <div
                  key={s}
                  className="px-4 py-2.5 text-[11px] font-mono text-white/60 break-all"
                >
                  {s}
                </div>
              ))
            )}
          </SettingsGroup>

          <SettingsGroup title="Project permissions">
            {Object.keys(oc.permission).length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-outline">
                {t('settings.opencode.9f71d8')}
              </div>
            ) : (
              <>
                <div className="px-4 py-2 text-[10px] text-outline">
                  {t('settings.opencode.00ff54')}
                </div>
                {Object.entries(oc.permission).map(([key, value]) => (
                  <SettingsRow
                    key={key}
                    title={key}
                    description={
                      typeof value === 'string'
                        ? value
                        : `${Object.keys(value || {}).length} pattern 規則`
                    }
                    control={
                      <span
                        className={`text-[10px] font-mono ${
                          value === 'deny'
                            ? 'text-error'
                            : value === 'ask'
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                        }`}
                      >
                        {typeof value === 'string' ? value : 'pattern'}
                      </span>
                    }
                  />
                ))}
              </>
            )}
          </SettingsGroup>

          <SettingsGroup title={t('settings.opencode.3abdb9')}>
            <div className="max-h-56 overflow-y-auto custom-scrollbar">
              {oc.agents.map((a) => (
                <SettingsRow
                  key={`${a.source}-${a.id}`}
                  title={`${a.label} (${a.id})`}
                  description={`${a.kind} · ${a.source}${a.model ? ` · ${a.model}` : ''}`}
                  control={
                    a.hidden ? (
                      <span className="text-[10px] text-outline">hidden</span>
                    ) : (
                      <span />
                    )
                  }
                />
              ))}
            </div>
          </SettingsGroup>

          <SettingsGroup title="Commands → Slash">
            {oc.commands.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-outline">
                無自訂 command。可在{' '}
                <code className="font-mono text-primary/70">.opencode/commands/*.md</code>{' '}
                新增。
              </div>
            ) : (
              oc.commands.map((c) => (
                <SettingsRow
                  key={c.path || c.id}
                  title={`/${c.id}`}
                  description={c.description || c.template.slice(0, 100)}
                  control={
                    c.agent ? (
                      <span className="text-[11px] text-outline font-mono">
                        agent={c.agent}
                      </span>
                    ) : (
                      <span />
                    )
                  }
                />
              ))
            )}
          </SettingsGroup>
        </div>
  )
}
