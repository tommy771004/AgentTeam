import {
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  settingsBtnCls,
  settingsBtnPrimaryCls,
} from '../SettingsChrome'

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
  return (
    <>
          <SettingsGroup title="Beta 更新通道">
            <SettingsRow
              title="目前版本"
              description="僅接受符合目前平台與架構、且版本較新的簽章 manifest。"
              control={<span className="text-[12px] font-mono text-on-surface-variant">{updateState?.currentVersion || '讀取中…'}</span>}
            />
            <SettingsRow
              title="檢查更新"
              description="通道與 public key 由安裝環境提供；驗證失敗會 fail closed。"
              control={<button type="button" className={settingsBtnPrimaryCls} onClick={() => void checkForUpdate()}>檢查</button>}
            />
            {updateState?.manifest && (
              <>
                <SettingsStack title={`Beta ${updateState.manifest.version}`} description={updateState.manifest.mandatory ? '必要更新' : '可延後更新'}>
                  <p className="text-[12px] leading-relaxed text-on-surface-variant whitespace-pre-wrap">{updateState.manifest.releaseNotes}</p>
                </SettingsStack>
                <SettingsRow
                  title="下載更新"
                  description={updateState.status === 'downloaded' ? '檔案已驗證，可開始安裝。' : '下載進度只反映已驗證的 HTTPS artifact。'}
                  control={
                    <div className="flex items-center gap-2">
                      {updateState.status !== 'downloaded' && <button type="button" className={settingsBtnPrimaryCls} onClick={() => void downloadCurrentUpdate()}>下載</button>}
                      {!updateState.manifest.mandatory && <button type="button" className={settingsBtnCls} onClick={() => void deferCurrentUpdate()}>延後</button>}
                    </div>
                  }
                />
                {updateState.status === 'downloaded' && (
                  <SettingsRow title="開始安裝" description="會先建立 N-1→N migration backup；安裝失敗可回復。" control={<button type="button" className={settingsBtnPrimaryCls} onClick={() => void installCurrentUpdate()}>安裝並重啟</button>} />
                )}
                {(updateState.status === 'install-pending' || updateState.status === 'failed') && (
                  <SettingsRow title="回復 migration" description="安裝器失敗或中斷時，保留目前版本並清除暫存更新檔。" control={<button type="button" className={settingsBtnCls} onClick={() => void rollbackCurrentUpdate()}>回復</button>} />
                )}
              </>
            )}
          </SettingsGroup>
          {(updateMsg || updateState?.lastError) && <p className="px-1 mb-3 text-[12px] text-on-surface-variant">{updateMsg || updateState?.lastError}</p>}
          {(updateProgress > 0 || updateState?.status === 'downloaded') && <div className="mx-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(updateProgress, updateState?.status === 'downloaded' ? 100 : 0)}%` }} /></div>}
    </>
  )
}
