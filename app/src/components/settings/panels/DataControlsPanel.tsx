import { useState } from 'react'
import { exportRunMetricsJsonl, metricsSummary, resetRunMetrics } from '../../../agent/metrics'
import type { LlmSettings } from '../../../agent/types'
import {
  SettingsGroup,
  SettingsRow,
  SettingsToggle,
  settingsBtnCls,
} from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 資料控制節。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function DataControlsPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const { t } = useTranslation()
  const [dataMsg, setDataMsg] = useState<string | null>(null)

  return (
    <>
          <SettingsGroup title={t('settings.data.a2b87b')}>
            <SettingsRow
              title={t('settings.data.fd7750')}
              description={(() => {
                const s = metricsSummary()
                return s.runs
                  ? `${s.runs} runs · ask ${s.toolAsks} / deny ${s.toolDenials}（denial ratio ${(s.denialRatio * 100).toFixed(1)}%）· 壓縮 ${s.compactions} 次 · LLM 重試 ${s.llmRetries} 次`
                  : t('settings.data.8b2627')
              })()}
              control={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={() => {
                      const jsonl = exportRunMetricsJsonl()
                      if (!jsonl) {
                        setDataMsg(t('settings.data.858dcc'))
                        return
                      }
                      const blob = new Blob([jsonl], { type: 'application/jsonl' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `subagents-metrics-${new Date().toISOString().slice(0, 10)}.jsonl`
                      a.click()
                      URL.revokeObjectURL(url)
                      setDataMsg(t('settings.data.ec2ffc'))
                    }}
                  >
                    {t('settings.data.1a6faf')}
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-error hover:underline"
                    onClick={() => {
                      resetRunMetrics()
                      setDataMsg(t('settings.data.2e6b28'))
                    }}
                  >
                    {t('settings.data.7b15e5')}
                  </button>
                </div>
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.data.d54f1b')}>
            <SettingsField
              id="data.temporaryChatDefault"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.temporaryChatDefault === true}
                  onChange={(v) => set({ temporaryChatDefault: v })}
                />
              }
            />
            <SettingsField
              id="data.autoArchiveDays"
              ctx={fieldCtx}
              description={
                (settings.autoArchiveDays ?? 0) === 0
                  ? t('settings.data.604f20')
                  : `${settings.autoArchiveDays} 天後封存`
              }
              control={
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={settings.autoArchiveDays ?? 0}
                  onChange={(e) =>
                    set({ autoArchiveDays: Number(e.target.value) })
                  }
                  className="w-36 accent-primary"
                />
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.data.4989b5')}>
            <SettingsRow
              title={t('settings.data.ffe673')}
              description={t('settings.data.6f951b')}
              control={
                <button
                  type="button"
                  className={settingsBtnCls}
                  onClick={() => {
                    window.location.hash = '#/records'
                  }}
                >
                  {t('settings.data.0ae5c7')}
                </button>
              }
            />
            <SettingsRow
              title={t('settings.data.489bdc')}
              description={t('settings.data.e1ae61')}
              control={
                <button
                  type="button"
                  className={settingsBtnCls + ' text-error border-error/30'}
                  onClick={async () => {
                    if (!confirm(t('settings.data.8ff258'))) return
                    try {
                      const { useThreadStore } = await import('../../../store/threadStore')
                      const st = useThreadStore.getState()
                      const ids = [...st.threads.map((t) => t.id)]
                      for (const id of ids) st.deleteThread(id)
                      const active = st.activeId
                      if (active) st.clearBubbles?.(active)
                      setDataMsg(t('settings.data.6717b0'))
                    } catch (e) {
                      setDataMsg(e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  {t('settings.data.a48f5d')}
                </button>
              }
            />
          </SettingsGroup>
          {dataMsg && (
            <p className="text-[12px] font-[family-name:var(--font-mono)] text-primary px-1">
              {dataMsg}
            </p>
          )}
    </>
  )
}
