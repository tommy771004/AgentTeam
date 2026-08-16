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
          <SettingsGroup title="方案">
            <SettingsRow
              title={entitlementSnapshot.tier === 'paid' ? '已啟用付費方案' : 'Free Core（本機優先，免登入）'}
              description={
                entitlementSnapshot.tier === 'paid'
                  ? `已授權功能：${[...entitlementSnapshot.grantedFeatures].join(', ') || '無'}`
                  : 'Local providers/CLI、專案、sessions、多代理、Plan/Goal、權限、skills/MCP、diff/terminal/history、匯出與 Handoff 皆免費、免登入可用。'
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
                    ? '訂閱已取消'
                    : subscription.status === 'refunded'
                      ? '訂閱已退款'
                      : '尚未訂閱 Pro'
                }
                description={
                  subscription.status === 'canceled'
                    ? '目前方案將於到期後轉為 Free Core；到期前仍可使用已授權功能。'
                    : subscription.status === 'refunded'
                      ? '已退款訂閱需重新購買才能再次啟用；本機資料與 Free Core 不受影響。'
                      : `Pro：US$${SUBSCRIPTION_PRICING.monthly.usd}/月 或 US$${SUBSCRIPTION_PRICING.annual.usd}/年（最多 ${subscription.maxDevices} 台裝置）。`
                }
                control={
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={() => void openExternalLink('https://subagents.ai/pricing')}
                  >
                    查看方案
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
                        移除裝置
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
            <SettingsGroup title="功能包">
              {featurePacks.filter((p) => p.status !== 'uninstalled').map((p) => (
                <SettingsRow
                  key={p.id}
                  title={`${p.manifest.name} v${p.manifest.version}`}
                  description={
                    p.status === 'entitlement-denied'
                      ? '需要更高方案授權才能啟用；Free Core 不受影響。'
                      : p.status === 'incompatible'
                        ? `需要 app 版本 ${p.manifest.minAppVersion}${p.manifest.maxAppVersion ? `–${p.manifest.maxAppVersion}` : '+'}。`
                        : p.status === 'disabled'
                          ? '已停用。'
                          : '已啟用。'
                  }
                  control={
                    <div className="flex items-center gap-2">
                      {p.status === 'active' ? (
                        <button type="button" className={settingsBtnCls} onClick={() => disableFeaturePackAction(p.id)}>停用</button>
                      ) : p.status === 'disabled' ? (
                        <button
                          type="button"
                          className={settingsBtnCls}
                          onClick={() => enableFeaturePackAction(p.id, appVersion || '0.0.0', subscriptionEntitlement)}
                        >
                          啟用
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
                      <button type="button" className={settingsBtnCls} onClick={() => uninstallFeaturePackAction(p.id)}>移除</button>
                    </div>
                  }
                />
              ))}
            </SettingsGroup>
          )}
          <SettingsGroup title="輸入與行為">
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
                  <option value="enter">Enter 送出</option>
                  <option value="cmdEnter">⌘/Ctrl+Enter 送出</option>
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
                  <option value="steer">轉向（Steer）</option>
                  <option value="queue">排隊（Queue）</option>
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
                <span className="font-semibold text-amber-200">實驗性：</span>
                多 run 呈現尚未完成。開啟後，活動、停止與介入畫面可能仍有跨 run 混線；建議暫時保持關閉。
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
          <SettingsGroup title="通知">
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
          <SettingsGroup title="建議">
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
