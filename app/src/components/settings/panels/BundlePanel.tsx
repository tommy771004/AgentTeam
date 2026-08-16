import { useState } from 'react'
import { bundleSensitivityNotice } from '../../../agent/settingsExport'
import {
  SettingsGroup,
  SettingsRow,
  settingsBtnCls,
  settingsBtnPrimaryCls,
} from '../SettingsChrome'
import { useTranslation } from '../../../i18n/useTranslation'

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
  const { t } = useTranslation()
  const [bundleMsg, setBundleMsg] = useState<string | null>(null)

  return (
    <>
      <SettingsGroup title={t('settings.bundle.e2d78e')}>
          <SettingsRow
            title={t('settings.bundle.495e57')}
            description={t('settings.bundle.3781c6')}
            control={
              <button
                type="button"
                className={settingsBtnPrimaryCls}
                onClick={async () => {
                  // Issue 06 — 匯出前明確同意：說明遮罩範圍與仍包含的敏感 metadata
                  if (!window.confirm(bundleSensitivityNotice())) {
                    setBundleMsg(t('settings.bundle.9f3791'))
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
                  setBundleMsg(t('settings.bundle.b34243'))
                }}
              >
                {t('settings.bundle.776608')}
              </button>
            }
          />
          <SettingsRow
            title={t('settings.bundle.97b336')}
            description={t('settings.bundle.b5c069')}
            control={
              <label className={settingsBtnCls + ' cursor-pointer'}>
                {t('settings.bundle.67b9a0')}
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