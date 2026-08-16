import {
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  settingsBtnCls,
  settingsBtnPrimaryCls,
} from '../SettingsChrome'
import { useTranslation } from '../../../i18n/useTranslation'

export type UpdateState = {
  status: string
  currentVersion: string
  manifest?: { version: string; mandatory: boolean; releaseNotes: string }
  progress: number
  deferredUntil?: string
  lastError?: string
} | null

/**
 * Settings registry restructure（spec 3/6）— 安全更新節。更新狀態機仍由設定頁擁有（多處共用版本號），這裡只呈現與觸發。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function UpdatesPanel({
  updateState,
  updateMsg,
  updateProgress,
  checkForUpdate,
  downloadCurrentUpdate,
  installCurrentUpdate,
  deferCurrentUpdate,
  rollbackCurrentUpdate,
}: {
  updateState: UpdateState
  updateMsg: string | null
  updateProgress: number
  checkForUpdate: () => void | Promise<void>
  downloadCurrentUpdate: () => void | Promise<void>
  installCurrentUpdate: () => void | Promise<void>
  deferCurrentUpdate: () => void | Promise<void>
  rollbackCurrentUpdate: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <>
          <SettingsGroup title={t('settings.updates.b86a93')}>
            <SettingsRow
              title={t('settings.updates.0f31d8')}
              description={t('settings.updates.50a87f')}
              control={<span className="text-[12px] font-mono text-on-surface-variant">{updateState?.currentVersion || t('settings.updates.75dc5e')}</span>}
            />
            <SettingsRow
              title={t('settings.updates.57d698')}
              description={t('settings.updates.c0bc14')}
              control={<button type="button" className={settingsBtnPrimaryCls} onClick={() => void checkForUpdate()}>{t('settings.updates.6faa5f')}</button>}
            />
            {updateState?.manifest && (
              <>
                <SettingsStack title={`Beta ${updateState.manifest.version}`} description={updateState.manifest.mandatory ? t('settings.updates.b39c66') : t('settings.updates.9f5118')}>
                  <p className="text-[12px] leading-relaxed text-on-surface-variant whitespace-pre-wrap">{updateState.manifest.releaseNotes}</p>
                </SettingsStack>
                <SettingsRow
                  title={t('settings.updates.cc54e3')}
                  description={updateState.status === 'downloaded' ? t('settings.updates.bccc4e') : t('settings.updates.c10221')}
                  control={
                    <div className="flex items-center gap-2">
                      {updateState.status !== 'downloaded' && <button type="button" className={settingsBtnPrimaryCls} onClick={() => void downloadCurrentUpdate()}>{t('settings.updates.4082c9')}</button>}
                      {!updateState.manifest.mandatory && <button type="button" className={settingsBtnCls} onClick={() => void deferCurrentUpdate()}>{t('settings.updates.fa9c90')}</button>}
                    </div>
                  }
                />
                {updateState.status === 'downloaded' && (
                  <SettingsRow title={t('settings.updates.729120')} description={t('settings.updates.347104')} control={<button type="button" className={settingsBtnPrimaryCls} onClick={() => void installCurrentUpdate()}>{t('settings.updates.6faf69')}</button>} />
                )}
                {(updateState.status === 'install-pending' || updateState.status === 'failed') && (
                  <SettingsRow title={t('settings.updates.7cc570')} description={t('settings.updates.8ead29')} control={<button type="button" className={settingsBtnCls} onClick={() => void rollbackCurrentUpdate()}>{t('settings.updates.b6c460')}</button>} />
                )}
              </>
            )}
          </SettingsGroup>
          {(updateMsg || updateState?.lastError) && <p className="px-1 mb-3 text-[12px] text-on-surface-variant">{updateMsg || updateState?.lastError}</p>}
          {(updateProgress > 0 || updateState?.status === 'downloaded') && <div className="mx-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(updateProgress, updateState?.status === 'downloaded' ? 100 : 0)}%` }} /></div>}
    </>
  )
}
