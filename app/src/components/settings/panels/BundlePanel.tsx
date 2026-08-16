import { useState } from 'react'
import { bundleSensitivityNotice } from '../../../agent/settingsExport'
import {
  SettingsGroup,
  SettingsRow,
  settingsBtnCls,
  settingsBtnPrimaryCls,
} from '../SettingsChrome'

/**
 * Settings registry restructure（spec 3/6 ticket 08）— 匯出匯入節。
 *
 * 純搬移：遮敏提示、確認對話框與匯入流程與搬移前完全相同，一個字都沒動。
 */
export function BundlePanel({
  exportBundle,
  importBundle,
}: {
  exportBundle: () => Promise<string>
  importBundle: (raw: string) => Promise<{ ok: boolean; message: string }>
}) {
  const [bundleMsg, setBundleMsg] = useState<string | null>(null)

  return (
    <>
      <SettingsGroup title="備份">
          <SettingsRow
            title="匯出設定包"
            description="含設定、排程與事件；API 金鑰與 token 會自動遮罩"
            control={
              <button
                type="button"
                className={settingsBtnPrimaryCls}
                onClick={async () => {
                  // Issue 06 — 匯出前明確同意：說明遮罩範圍與仍包含的敏感 metadata
                  if (!window.confirm(bundleSensitivityNotice())) {
                    setBundleMsg('已取消匯出。')
                    return
                  }
                  const json = await exportBundle()
                  const blob = new Blob([json], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `subagents-bundle-${Date.now()}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                  setBundleMsg('已下載匯出檔。')
                }}
              >
                匯出 JSON
              </button>
            }
          />
          <SettingsRow
            title="匯入設定包"
            description="覆寫本機設定"
            control={
              <label className={settingsBtnCls + ' cursor-pointer'}>
                匯入 JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const text = await file.text()
                    const r = await importBundle(text)
                    setBundleMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`)
                    e.target.value = ''
                  }}
                />
              </label>
            }
          />
      </SettingsGroup>
      {bundleMsg ? (
        <p className="mb-4 px-1 text-[12px] text-on-surface-variant font-[family-name:var(--font-mono)]">
          {bundleMsg}
        </p>
      ) : null}
    </>
  )
}