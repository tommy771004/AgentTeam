import type { LlmSettings, PersonalityPreset } from '../../../agent/types'
import { PillSelect, SettingsGroup, settingsInputCls } from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 個人化節。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function PersonalizationPanel({
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
          <SettingsGroup title={t('settings.personalization.63f44a')}>
            <SettingsField
              id="personalization.personality"
              ctx={fieldCtx}
              control={
                <PillSelect
                  value={settings.personality || 'default'}
                  onChange={(v) =>
                    set({ personality: v as PersonalityPreset })
                  }
                >
                  <option value="default">{t('settings.personalization.f7f780')}</option>
                  <option value="none">{t('settings.personalization.afbae3')}</option>
                  <option value="friendly">{t('settings.personalization.0e083d')}</option>
                  <option value="efficient">{t('settings.personalization.45997b')}</option>
                  <option value="professional">{t('settings.personalization.7d7671')}</option>
                  <option value="candid">{t('settings.personalization.b83afd')}</option>
                  <option value="quirky">{t('settings.personalization.2ffb51')}</option>
                </PillSelect>
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.personalization.a583fc')}>
            <SettingsField id="personalization.customAboutUser" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[96px] resize-y'}
                value={settings.customAboutUser || ''}
                onChange={(e) => set({ customAboutUser: e.target.value })}
                placeholder={t('settings.personalization.be9753')}
              />
            </SettingsField>
            <SettingsField id="personalization.customResponseStyle" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[96px] resize-y'}
                value={settings.customResponseStyle || ''}
                onChange={(e) =>
                  set({ customResponseStyle: e.target.value })
                }
                placeholder={t('settings.personalization.429fd6')}
              />
            </SettingsField>
          </SettingsGroup>
    </>
  )
}
