import type { LlmSettings } from '../../../agent/types'
import { SettingsGroup, SettingsToggle, settingsInputCls } from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— Git 節。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function GitPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const { t } = useTranslation()
  return (
    <>
          <SettingsGroup title={t('settings.git.67087a')}>
            <SettingsField
              id="git.gitBranchPrefix"
              ctx={fieldCtx}
              control={
                <input
                  className={settingsInputCls + ' w-40 text-right'}
                  value={settings.gitBranchPrefix || ''}
                  onChange={(e) => set({ gitBranchPrefix: e.target.value })}
                  placeholder="agent/"
                />
              }
            />
            <SettingsField
              id="git.gitCreateDraftPr"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.gitCreateDraftPr !== false}
                  onChange={(v) => set({ gitCreateDraftPr: v })}
                />
              }
            />
            <SettingsField
              id="git.gitForcePush"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.gitForcePush === true}
                  onChange={(v) => set({ gitForcePush: v })}
                />
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.git.24473e')}>
            <SettingsField id="git.gitCommitInstructions" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[72px] resize-y'}
                value={settings.gitCommitInstructions || ''}
                onChange={(e) =>
                  set({ gitCommitInstructions: e.target.value })
                }
                placeholder={t('settings.git.e1f513')}
              />
            </SettingsField>
            <SettingsField id="git.gitPrInstructions" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[72px] resize-y'}
                value={settings.gitPrInstructions || ''}
                onChange={(e) => set({ gitPrInstructions: e.target.value })}
                placeholder={t('settings.git.be386a')}
              />
            </SettingsField>
          </SettingsGroup>
    </>
  )
}
