import { useEffect, useState } from 'react'
import type { LlmSettings } from '../../../agent/types'
import { SettingsGroup, SettingsToggle, settingsBtnCls, settingsInputCls } from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'

/**
 * Settings registry restructure（spec 3/6）— Webhook 節。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function WebhookPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null)

  // 這裡只是為了把狀態字串顯示出來——webhook 的真正生命週期由 App 的
  // WebhookBootstrap 擁有（開 app 就依設定啟停），不依賴有沒有人打開這一節。
  // Auto-apply webhook when related settings change
  useEffect(() => {
    if (!window.subagents?.webhook) return
    let cancelled = false
    void (async () => {
      try {
        if (settings.webhookEnabled) {
          const st = await window.subagents!.webhook!.start({
            port: settings.webhookPort || 8787,
            token: settings.webhookToken || '',
          })
          if (!cancelled) {
            setWebhookStatus(
              st.running
                ? `Webhook 聆聽中：${st.url}`
                : `Webhook 失敗：${st.lastError || '未知'}`,
            )
          }
        } else {
          await window.subagents!.webhook!.stop()
          if (!cancelled) setWebhookStatus(null)
        }
      } catch (e) {
        if (!cancelled) setWebhookStatus(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [settings.webhookEnabled, settings.webhookPort, settings.webhookToken])

  return (
    <>
          <SettingsGroup title="本機 Webhook">
            <SettingsField
              id="webhook.webhookEnabled"
              ctx={fieldCtx}
              description="聆聽 127.0.0.1"
              control={
                <SettingsToggle
                  checked={settings.webhookEnabled === true}
                  onChange={(v) => set({
                    webhookEnabled: v,
                    ...(v && !settings.webhookToken
                      ? { webhookToken: crypto.randomUUID().replace(/-/g, '') }
                      : {}),
                  })}
                />
              }
            />
            <SettingsField
              id="webhook.webhookPort"
              ctx={fieldCtx}
              control={
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  className={settingsInputCls + ' w-28 text-right'}
                  value={settings.webhookPort || 8787}
                  onChange={(e) =>
                    set({ webhookPort: Number(e.target.value) || 8787 })
                  }
                />
              }
            />
            <SettingsField id="webhook.webhookToken" ctx={fieldCtx}>
              <input
                type="password"
                className={settingsInputCls}
                value={settings.webhookToken || ''}
                onChange={(e) => set({ webhookToken: e.target.value })}
                autoComplete="off"
              />
            </SettingsField>
            <SettingsField id="webhook.webhookTarget" ctx={fieldCtx}>
              <input
                type="url"
                className={settingsInputCls}
                value={settings.webhookTarget || ''}
                onChange={(e) => set({ webhookTarget: e.target.value })}
                placeholder="https://example.com/hooks/subagents"
                autoComplete="off"
              />
              <p className="text-[11px] text-outline mt-1">
                只有 Next_State=Dispatch Webhook 才會送出；未設定或非 http/https 會留下失敗 audit。
              </p>
            </SettingsField>
          </SettingsGroup>
          <pre className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant overflow-x-auto whitespace-pre-wrap mb-4">
            {`curl -X POST http://127.0.0.1:${settings.webhookPort || 8787}/webhook \\
    -H "Content-Type: application/json" \\
    -d '{"source":"email.received","subject":"Invoice 42","hasAttachment":true}'`}
          </pre>
          {webhookStatus && (
            <p className="text-[12px] font-[family-name:var(--font-mono)] text-primary px-1">
              {webhookStatus}
            </p>
          )}
    </>
  )
}
