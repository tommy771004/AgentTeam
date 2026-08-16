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
  const [dataMsg, setDataMsg] = useState<string | null>(null)

  return (
    <>
          <SettingsGroup title="運行指標（G11）">
            <SettingsRow
              title="本地指標"
              description={(() => {
                const s = metricsSummary()
                return s.runs
                  ? `${s.runs} runs · ask ${s.toolAsks} / deny ${s.toolDenials}（denial ratio ${(s.denialRatio * 100).toFixed(1)}%）· 壓縮 ${s.compactions} 次 · LLM 重試 ${s.llmRetries} 次`
                  : '尚無紀錄；每個 run 結束時自動記一筆（只記數字，不含 prompt 內容）'
              })()}
              control={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={() => {
                      const jsonl = exportRunMetricsJsonl()
                      if (!jsonl) {
                        setDataMsg('沒有可匯出的指標')
                        return
                      }
                      const blob = new Blob([jsonl], { type: 'application/jsonl' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `subagents-metrics-${new Date().toISOString().slice(0, 10)}.jsonl`
                      a.click()
                      URL.revokeObjectURL(url)
                      setDataMsg('指標已匯出（JSONL）')
                    }}
                  >
                    匯出 JSONL
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-error hover:underline"
                    onClick={() => {
                      resetRunMetrics()
                      setDataMsg('指標已清除')
                    }}
                  >
                    清除
                  </button>
                </div>
              }
            />
          </SettingsGroup>
          <SettingsGroup title="對話">
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
                  ? '不自動封存'
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
          <SettingsGroup title="管理">
            <SettingsRow
              title="封存與日誌"
              description="開啟紀錄頁"
              control={
                <button
                  type="button"
                  className={settingsBtnCls}
                  onClick={() => {
                    window.location.hash = '#/records'
                  }}
                >
                  開啟
                </button>
              }
            />
            <SettingsRow
              title="刪除全部對話"
              description="不可復原"
              control={
                <button
                  type="button"
                  className={settingsBtnCls + ' text-error border-error/30'}
                  onClick={async () => {
                    if (!confirm('清除所有對話執行緒？（不可復原）')) return
                    try {
                      const { useThreadStore } = await import('../../../store/threadStore')
                      const st = useThreadStore.getState()
                      const ids = [...st.threads.map((t) => t.id)]
                      for (const id of ids) st.deleteThread(id)
                      const active = st.activeId
                      if (active) st.clearBubbles?.(active)
                      setDataMsg('已清除對話執行緒')
                    } catch (e) {
                      setDataMsg(e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  刪除
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
