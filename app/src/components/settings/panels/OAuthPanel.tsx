import { useState } from 'react'
import {
  OAUTH_REDIRECT_URI,
  PLUGIN_OAUTH_PROVIDERS,
} from '../../../agent/hermes/pluginOAuth'
import { listPluginSecretMeta, secretNeedsRefresh } from '../../../agent/hermes/pluginSecrets'
import { useLearningStore } from '../../../store/learningStore'
import type { LlmSettings } from '../../../agent/types'
import {
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  settingsBtnCls,
  settingsInputCls,
} from '../SettingsChrome'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 外掛 OAuth 節。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function OAuthPanel({
  settings,
  set,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
}) {
  const { t } = useTranslation()
  const [oauthRefreshMsg, setOauthRefreshMsg] = useState<string | null>(null)
  const refreshPluginTokens = useLearningStore((s) => s.refreshPluginTokens)

  return (
    <>
          <SettingsGroup title={t('settings.oauth.a176d2')}>
            <SettingsStack title={t('settings.oauth.88b266')}>
              <code className="block text-[12px] font-[family-name:var(--font-mono)] text-on-surface break-all">
                {OAUTH_REDIRECT_URI}
              </code>
              <p className="mt-2 text-[11px] text-outline leading-relaxed">
                {t('settings.oauth.0e0066')}<strong>{t('settings.oauth.9f5d4a')}</strong>{t('settings.oauth.4c784e')}
              </p>
            </SettingsStack>
            <SettingsRow
              title={t('settings.oauth.00fd4c')}
              description={t('settings.oauth.ab79bd')}
              control={
                <button
                  type="button"
                  className={settingsBtnCls}
                  onClick={() => {
                    void refreshPluginTokens().then((n) => {
                      setOauthRefreshMsg(n > 0 ? `已刷新 ${n} 個 token` : t('settings.oauth.7fdfb3'))
                    })
                  }}
                >
                  {t('settings.oauth.27e4aa')}
                </button>
              }
            />
            {oauthRefreshMsg && (
              <p className="px-4 pb-3 text-[11px] text-on-surface-variant">{oauthRefreshMsg}</p>
            )}
          </SettingsGroup>

          <SettingsGroup title={t('settings.oauth.1e8339')}>
            {Array.from(
              new Map(
                Object.values(PLUGIN_OAUTH_PROVIDERS).map((p) => [
                  p.clientKey,
                  {
                    key: p.clientKey,
                    flow: p.flow,
                    docsUrl: p.docsUrl,
                    needsSecret: p.tokenAuth === 'basic' || p.flow === 'code',
                  },
                ]),
              ).values(),
            ).map((row) => {
              const live = settings.pluginOAuthClients?.[row.key] || { clientId: '', clientSecret: '' }
              return (
                <div key={row.key} className="border-b border-white/[0.06] last:border-0 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-semibold text-on-surface capitalize">{row.key}</div>
                      <div className="text-[11px] text-outline">
                        {row.flow === 'device' ? t('settings.oauth.9c5752') : t('settings.oauth.2876e2')}
                        {row.needsSecret ? t('settings.oauth.70b163') : ''}
                      </div>
                    </div>
                    {row.docsUrl && (
                      <a
                        href={row.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        {t('settings.oauth.646be9')}
                      </a>
                    )}
                  </div>
                  <input
                    type="text"
                    className={settingsInputCls + ' font-[family-name:var(--font-mono)] text-[12px]'}
                    placeholder="Client ID"
                    value={live.clientId || ''}
                    autoComplete="off"
                    onChange={(e) =>
                      set({
                        pluginOAuthClients: {
                          ...(settings.pluginOAuthClients || {}),
                          [row.key]: { ...live, clientId: e.target.value },
                        },
                      })
                    }
                  />
                  <input
                    type="password"
                    className={settingsInputCls + ' font-[family-name:var(--font-mono)] text-[12px]'}
                    placeholder={t('settings.oauth.8ce866')}
                    value={live.clientSecret || ''}
                    autoComplete="off"
                    onChange={(e) =>
                      set({
                        pluginOAuthClients: {
                          ...(settings.pluginOAuthClients || {}),
                          [row.key]: { ...live, clientSecret: e.target.value },
                        },
                      })
                    }
                  />
                </div>
              )
            })}
          </SettingsGroup>

          <SettingsGroup title={t('settings.oauth.58c214')}>
            <div className="px-4 py-3 space-y-1.5 text-[12px]">
              {listPluginSecretMeta().length === 0 ? (
                <p className="text-outline">{t('settings.oauth.432bb4')}</p>
              ) : (
                listPluginSecretMeta().map((meta) => (
                  <div
                    key={meta.id}
                    className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5 last:border-0"
                  >
                    <span className="font-[family-name:var(--font-mono)] text-on-surface-variant truncate">
                      {meta.id}
                      <span className="ml-2 text-outline">{meta.tokenHint}</span>
                      {meta.encrypted ? (
                        <span className="ml-2 text-[10px] text-primary/80">vault</span>
                      ) : (
                        <span className="ml-2 text-[10px] text-amber-300/80">{t('settings.oauth.412b25')}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-outline">
                      {meta.hasRefreshToken
                        ? secretNeedsRefresh(meta)
                          ? t('settings.oauth.6bd184')
                          : meta.expiresAt
                            ? `到期 ${new Date(meta.expiresAt).toLocaleString()}`
                            : t('settings.oauth.e1392e')
                        : t('settings.oauth.8a7dfe')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </SettingsGroup>
    </>
  )
}
