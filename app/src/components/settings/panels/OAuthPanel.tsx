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
  const [oauthRefreshMsg, setOauthRefreshMsg] = useState<string | null>(null)
  const refreshPluginTokens = useLearningStore((s) => s.refreshPluginTokens)

  return (
    <>
          <SettingsGroup title="本機 OAuth 回呼">
            <SettingsStack title="Redirect URI（code flow 必須完全一致）">
              <code className="block text-[12px] font-[family-name:var(--font-mono)] text-on-surface break-all">
                {OAUTH_REDIRECT_URI}
              </code>
              <p className="mt-2 text-[11px] text-outline leading-relaxed">
                GitHub 使用<strong>裝置碼</strong>（通常只需 Client ID）。Notion / Google / Dropbox 等需在開發者後台登錄此 Redirect URI。
                Access token 存在本機 secret store；有 refresh_token 時會每分鐘檢查並自動 refresh。
              </p>
            </SettingsStack>
            <SettingsRow
              title="立即刷新到期 token"
              description="對所有含 refresh_token 且即將過期的 connector 執行一次 refresh"
              control={
                <button
                  type="button"
                  className={settingsBtnCls}
                  onClick={() => {
                    void refreshPluginTokens().then((n) => {
                      setOauthRefreshMsg(n > 0 ? `已刷新 ${n} 個 token` : '目前沒有需要刷新的 token')
                    })
                  }}
                >
                  立即 refresh
                </button>
              }
            />
            {oauthRefreshMsg && (
              <p className="px-4 pb-3 text-[11px] text-on-surface-variant">{oauthRefreshMsg}</p>
            )}
          </SettingsGroup>

          <SettingsGroup title="OAuth Client 憑證">
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
                        {row.flow === 'device' ? '裝置碼流程' : 'Code + 本機回呼'}
                        {row.needsSecret ? ' · 建議填 Client Secret' : ''}
                      </div>
                    </div>
                    {row.docsUrl && (
                      <a
                        href={row.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        開發者後台
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
                    placeholder="Client Secret（選填／部分供應商必要）"
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

          <SettingsGroup title="本機 token 狀態">
            <div className="px-4 py-3 space-y-1.5 text-[12px]">
              {listPluginSecretMeta().length === 0 ? (
                <p className="text-outline">尚無 connector 密鑰 — 在學習中心 → 外掛完成授權後會顯示於此。</p>
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
                        <span className="ml-2 text-[10px] text-amber-300/80">未加密（無 OS 鑰匙圈）</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-outline">
                      {meta.hasRefreshToken
                        ? secretNeedsRefresh(meta)
                          ? 'refresh 待執行'
                          : meta.expiresAt
                            ? `到期 ${new Date(meta.expiresAt).toLocaleString()}`
                            : '有 refresh_token'
                        : '無 refresh（PAT / 裝置碼）'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </SettingsGroup>
    </>
  )
}
