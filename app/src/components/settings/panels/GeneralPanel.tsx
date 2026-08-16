import { SUBSCRIPTION_PRICING } from '../../../agent/subscription'
import type { EnterBehavior, FollowUpMode, LlmSettings } from '../../../agent/types'
import { useEntitlementStore } from '../../../store/entitlementStore'
import { useFeaturePackStore } from '../../../store/featurePackStore'
import { useSubscriptionStore } from '../../../store/subscriptionStore'
import {
  PillSelect,
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  SettingsToggle,
  settingsBtnCls,
} from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'
import { Icon } from '../../Icon'
import { openExternalLink } from '../../../lib/electronBridge'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 一般節（方案、功能包、輸入與行為、通知、建議）。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function GeneralPanel({
  settings,
  set,
  fieldCtx,
  appVersion,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
  /** 功能包啟用／回復需要比對的 app 版本 */
  appVersion?: string
}) {
  const { t } = useTranslation()
  const entitlementSnapshot = useEntitlementStore((s) => s.snapshot)
  const subscription = useSubscriptionStore((s) => s.state)
  const subscriptionEntitlement = useSubscriptionStore((s) => s.entitlement)
  const subscriptionError = useSubscriptionStore((s) => s.lastError)
  const removeSubscriptionDevice = useSubscriptionStore((s) => s.removeDevice)
  const featurePacks = useFeaturePackStore((s) => s.packs)
  const disableFeaturePackAction = useFeaturePackStore((s) => s.disable)
  const enableFeaturePackAction = useFeaturePackStore((s) => s.enable)
  const uninstallFeaturePackAction = useFeaturePackStore((s) => s.uninstall)
  const rollbackFeaturePackAction = useFeaturePackStore((s) => s.rollback)

  return (
    <>
          <SettingsGroup title={t('settings.general.0fee25')}>
            <SettingsRow
              title={entitlementSnapshot.tier === 'paid' ? t('settings.general.069210') : t('settings.general.4f2521')}
              description={
                entitlementSnapshot.tier === 'paid'
                  ? `已授權功能：${[...entitlementSnapshot.grantedFeatures].join(', ') || t('settings.general.9ecc4e')}`
                  : t('settings.general.1c85a8')
              }
              control={
                <span className="rounded-full border border-outline/30 px-2.5 py-1 text-[11px] font-medium">
                  {entitlementSnapshot.tier === 'paid' ? 'Pro' : 'Free Core'}
                </span>
              }
            />
            {subscription.status !== 'active' && (
              <SettingsRow
                title={
                  subscription.status === 'canceled'
                    ? t('settings.general.f88962')
                    : subscription.status === 'refunded'
                      ? t('settings.general.b5eac1')
                      : t('settings.general.f0c14d')
                }
                description={
                  subscription.status === 'canceled'
                    ? t('settings.general.1b9fcd')
                    : subscription.status === 'refunded'
                      ? t('settings.general.f4483b')
                      : `Pro：US$${SUBSCRIPTION_PRICING.monthly.usd}/月 或 US$${SUBSCRIPTION_PRICING.annual.usd}/年（最多 ${subscription.maxDevices} 台裝置）。`
                }
                control={
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={() => void openExternalLink('https://subagents.ai/pricing')}
                  >
                    {t('settings.general.0b40b5')}
                  </button>
                }
              />
            )}
            {subscription.status === 'active' && subscription.devices.length > 0 && (
              <SettingsStack title={`已啟用裝置（${subscription.devices.length}/${subscription.maxDevices}）`}>
                {subscription.devices.map((d) => (
                  <SettingsRow
                    key={d.deviceId}
                    title={d.label || d.deviceId}
                    description={`啟用於 ${new Date(d.activatedAt).toLocaleString()}`}
                    control={
                      <button
                        type="button"
                        className={settingsBtnCls}
                        onClick={() => removeSubscriptionDevice(d.deviceId)}
                      >
                        {t('settings.general.fcb920')}
                      </button>
                    }
                  />
                ))}
              </SettingsStack>
            )}
            {subscriptionError && (
              <div
                role="status"
                className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90"
              >
                <Icon name="warning" size={15} className="mt-0.5 shrink-0 text-amber-300" />
                <p>{subscriptionError}</p>
              </div>
            )}
          </SettingsGroup>
          {featurePacks.length > 0 && (
            <SettingsGroup title={t('settings.general.477c5e')}>
              {featurePacks.filter((p) => p.status !== 'uninstalled').map((p) => (
                <SettingsRow
                  key={p.id}
                  title={`${p.manifest.name} v${p.manifest.version}`}
                  description={
                    p.status === 'entitlement-denied'
                      ? t('settings.general.e045d3')
                      : p.status === 'incompatible'
                        ? `需要 app 版本 ${p.manifest.minAppVersion}${p.manifest.maxAppVersion ? `–${p.manifest.maxAppVersion}` : '+'}。`
                        : p.status === 'disabled'
                          ? t('settings.general.52ff3b')
                          : t('settings.general.1165f3')
                  }
                  control={
                    <div className="flex items-center gap-2">
                      {p.status === 'active' ? (
                        <button type="button" className={settingsBtnCls} onClick={() => disableFeaturePackAction(p.id)}>{t('settings.general.d989e5')}</button>
                      ) : p.status === 'disabled' ? (
                        <button
                          type="button"
                          className={settingsBtnCls}
                          onClick={() => enableFeaturePackAction(p.id, appVersion || '0.0.0', subscriptionEntitlement)}
                        >
                          {t('settings.general.ce6c3d')}
                        </button>
                      ) : null}
                      {p.previousManifest && (
                        <button
                          type="button"
                          className={settingsBtnCls}
                          onClick={() => rollbackFeaturePackAction(p.id, appVersion || '0.0.0', subscriptionEntitlement)}
                        >
                          回復 v{p.previousManifest.version}
                        </button>
                      )}
                      <button type="button" className={settingsBtnCls} onClick={() => uninstallFeaturePackAction(p.id)}>{t('settings.general.2f752c')}</button>
                    </div>
                  }
                />
              ))}
            </SettingsGroup>
          )}
          <SettingsGroup title={t('settings.general.ccc7f0')}>
            <SettingsField
              id="general.enterBehavior"
              ctx={fieldCtx}
              control={
                <PillSelect
                  value={settings.enterBehavior || 'enter'}
                  onChange={(v) =>
                    set({ enterBehavior: v as EnterBehavior })
                  }
                >
                  <option value="enter">{t('settings.general.6129ad')}</option>
                  <option value="cmdEnter">{t('settings.general.34c967')}</option>
                </PillSelect>
              }
            />
            <SettingsField
              id="general.followUpMode"
              ctx={fieldCtx}
              control={
                <PillSelect
                  value={settings.followUpMode || 'steer'}
                  onChange={(v) =>
                    set({ followUpMode: v as FollowUpMode })
                  }
                >
                  <option value="steer">{t('settings.general.0bbe80')}</option>
                  <option value="queue">{t('settings.general.d2adc0')}</option>
                </PillSelect>
              }
            />
            <SettingsField
              id="general.concurrentRunsEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.concurrentRunsEnabled === true}
                  onChange={(v) => set({ concurrentRunsEnabled: v })}
                />
              }
            />
            <div
              role="status"
              className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90"
            >
              <Icon name="warning" size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <p>
                <span className="font-semibold text-amber-200">{t('settings.general.ca031f')}</span>
                {t('settings.general.807418')}
              </p>
            </div>
            {settings.concurrentRunsEnabled === true && (
              <SettingsField
                id="general.maxConcurrentRuns"
                ctx={fieldCtx}
                control={
                  <PillSelect
                    value={String(settings.maxConcurrentRuns || 4)}
                    onChange={(v) => set({ maxConcurrentRuns: Number(v) })}
                  >
                    <option value="2">2 runs</option>
                    <option value="3">3 runs</option>
                    <option value="4">4 runs</option>
                    <option value="6">6 runs</option>
                    <option value="8">8 runs</option>
                  </PillSelect>
                }
              />
            )}
          </SettingsGroup>
          <SettingsGroup title={t('settings.general.7a66c0')}>
            <SettingsField
              id="general.notifyOnComplete"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.notifyOnComplete !== false}
                  onChange={(v) => set({ notifyOnComplete: v })}
                />
              }
            />
            <SettingsField
              id="general.soundOnComplete"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.soundOnComplete === true}
                  onChange={(v) => set({ soundOnComplete: v })}
                />
              }
            />
            <SettingsField
              id="general.preventSleepWhileRunning"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.preventSleepWhileRunning === true}
                  onChange={(v) => set({ preventSleepWhileRunning: v })}
                />
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.general.dd6c3f')}>
            <SettingsField
              id="general.ambientSuggestions"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.ambientSuggestions !== false}
                  onChange={(v) => set({ ambientSuggestions: v })}
                />
              }
            />
          </SettingsGroup>
    </>
  )
}
