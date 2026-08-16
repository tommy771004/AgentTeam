import { useEffect, useState } from 'react'
import { useGatewayStore } from '../../../store/gatewayStore'
import type { LlmSettings } from '../../../agent/types'
import {
  SettingsGroup,
  SettingsRow,
  SettingsToggle,
  settingsBtnCls,
  settingsInputCls,
} from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 訊息閘道節（Telegram）。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function GatewayPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const { t } = useTranslation()
  const [gatewayMsg, setGatewayMsg] = useState<string | null>(null)
  const gatewayInbound = useGatewayStore((s) => s.inbound)
  const bgJobs = useGatewayStore((s) => s.jobs)

  // Auto-refresh gateway status when telegram settings change (start/stop is in App.tsx)
  useEffect(() => {
    if (!window.subagents?.gateway?.status) return
    let cancelled = false
    void (async () => {
      // brief delay so App bootstrap can start/stop first
      await new Promise((r) => setTimeout(r, 200))
      if (cancelled) return
      try {
        const st = await window.subagents!.gateway!.status()
        if (!cancelled) {
          setGatewayMsg(
            settings.telegramEnabled
              ? `${st.telegram.running ? t('settings.gateway.ae7738') : t('settings.gateway.75dddf')}${
                  st.telegram.botUsername ? ` @${st.telegram.botUsername}` : ''
                }${st.telegram.lastError ? ` · ${st.telegram.lastError}` : ''}`
              : t('settings.gateway.e8a92f'),
          )
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    settings.telegramEnabled,
    settings.telegramBotToken,
    settings.telegramAllowedChatIds,
  ])

  return (
    <>
          <SettingsGroup title="Telegram">
            <SettingsField
              id="gateway.telegramEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.telegramEnabled === true}
                  onChange={(v) => set({ telegramEnabled: v })}
                />
              }
            />
            <SettingsField id="gateway.telegramBotToken" ctx={fieldCtx}>
              <input
                className={settingsInputCls}
                type="password"
                value={settings.telegramBotToken || ''}
                onChange={(e) => set({ telegramBotToken: e.target.value })}
                placeholder="123456:ABC-DEF..."
              />
            </SettingsField>
            <SettingsField id="gateway.telegramAllowedChatIds" ctx={fieldCtx} description={t('settings.gateway.260893')}>
              <input
                className={settingsInputCls}
                value={settings.telegramAllowedChatIds || ''}
                onChange={(e) =>
                  set({ telegramAllowedChatIds: e.target.value })
                }
                placeholder={t('settings.gateway.963ba8')}
              />
            </SettingsField>
            <SettingsField
              id="gateway.telegramAutoRun"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.telegramAutoRun !== false}
                  onChange={(v) => set({ telegramAutoRun: v })}
                />
              }
            />
            <SettingsField
              id="gateway.telegramReplyWithResult"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.telegramReplyWithResult !== false}
                  onChange={(v) => set({ telegramReplyWithResult: v })}
                />
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.gateway.1a25d8')}>
            <SettingsRow
              title={t('settings.gateway.d37167')}
              description={t('settings.gateway.a6e4e0')}
              control={
                <button
                  type="button"
                  className={settingsBtnCls}
                  onClick={async () => {
                    const st = await window.subagents?.gateway?.status()
                    setGatewayMsg(
                      st
                        ? `${st.telegram.running ? t('settings.gateway.ae7738') : t('settings.gateway.75dddf')}${
                            st.telegram.botUsername ? ` @${st.telegram.botUsername}` : ''
                          } · msgs=${st.telegram.messageCount}${
                            st.telegram.lastError ? ` · ${st.telegram.lastError}` : ''
                          }`
                        : t('settings.gateway.c40199'),
                    )
                  }}
                >
                  {t('settings.gateway.5387b5')}
                </button>
              }
            />
          </SettingsGroup>
          {gatewayMsg && (
            <p className="text-[12px] font-[family-name:var(--font-mono)] text-primary mb-3 px-1">
              {gatewayMsg}
            </p>
          )}
          <SettingsGroup title={t('settings.gateway.8d6bfc')}>
            <div className="px-4 py-3">
              {gatewayInbound.length === 0 ? (
                <p className="text-[12px] text-outline">{t('settings.gateway.28115f')}</p>
              ) : (
                <ul className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar text-[11px] font-[family-name:var(--font-mono)]">
                  {gatewayInbound.slice(0, 12).map((m, i) => (
                    <li key={`${m.receivedAt}-${i}`} className="text-on-surface-variant">
                      [{m.channel}] {m.from || m.chatId}: {m.text.slice(0, 100)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SettingsGroup>
          <SettingsGroup title={t('settings.gateway.067f6d')}>
            <div className="px-4 py-3">
              {bgJobs.length === 0 ? (
                <p className="text-[12px] text-outline">
                  {t('settings.gateway.c59a62')}
                </p>
              ) : (
                <ul className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar text-[11px] font-[family-name:var(--font-mono)]">
                  {bgJobs.slice(0, 12).map((j) => (
                    <li key={j.id} className="text-on-surface-variant">
                      {j.id} [{j.status}] {j.goal.slice(0, 60)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SettingsGroup>
    </>
  )
}
