import { UI_LANGUAGES } from '../../../i18n'
import { useTranslation } from '../../../i18n/useTranslation'
import type {
  LlmSettings,
  ReducedMotionPreference,
  ThemePreference,
  UiLanguagePreference,
} from '../../../agent/types'
import { reopenOnboardingTour } from '../../OnboardingTour'
import { PillSelect, SettingsToggle, settingsBtnCls } from '../SettingsChrome'
import {
  SettingsField,
  SettingsGroupFor,
  type SettingsFieldContext,
} from '../SettingsField'

/**
 * Settings registry restructure（spec 3/6 ticket 01）— 外觀節。
 * Full localization（spec 6/6 ticket 01）— 第一個完整走 `t()` 的節。
 *
 * 哪幾列會出現由 metadata 的 tier 決定，這裡只提供控件本身；文字全部來自語言檔。
 */
export function AppearancePanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const { t } = useTranslation()
  const languageLabel: Record<UiLanguagePreference, string> = {
    system: t('settings.appearance.language.system'),
    'zh-TW': t('settings.appearance.language.zhTW'),
    en: t('settings.appearance.language.en'),
  }

  return (
    <>
      <SettingsGroupFor
        section="appearance"
        group="主題"
        titleKey="settings.appearance.group.theme"
        ctx={fieldCtx}
      >
        <SettingsField
          id="appearance.language"
          ctx={fieldCtx}
          control={
            <PillSelect
              value={settings.uiLanguage || 'system'}
              onChange={(v) => set({ uiLanguage: v as UiLanguagePreference })}
            >
              <option value="system">{languageLabel.system}</option>
              {UI_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {languageLabel[language]}
                </option>
              ))}
            </PillSelect>
          }
        />
        <SettingsField
          id="appearance.theme"
          ctx={fieldCtx}
          control={
            <PillSelect
              value={settings.theme || 'dark'}
              onChange={(v) => set({ theme: v as ThemePreference })}
            >
              <option value="dark">{t('settings.appearance.theme.dark')}</option>
              <option value="light">{t('settings.appearance.theme.light')}</option>
              <option value="system">{t('settings.appearance.theme.system')}</option>
            </PillSelect>
          }
        />
        <SettingsField
          id="appearance.reducedMotion"
          ctx={fieldCtx}
          control={
            <PillSelect
              value={settings.reducedMotion || 'system'}
              onChange={(v) => set({ reducedMotion: v as ReducedMotionPreference })}
            >
              <option value="system">{t('settings.appearance.theme.system')}</option>
              <option value="on">{t('settings.appearance.reducedMotion.on')}</option>
              <option value="off">{t('settings.appearance.reducedMotion.off')}</option>
            </PillSelect>
          }
        />
        <SettingsField
          id="appearance.translucentSidebar"
          ctx={fieldCtx}
          control={
            <SettingsToggle
              checked={settings.translucentSidebar !== false}
              onChange={(v) => set({ translucentSidebar: v })}
            />
          }
        />
      </SettingsGroupFor>

      <SettingsGroupFor
        section="appearance"
        group="導覽"
        titleKey="settings.appearance.group.tour"
        ctx={fieldCtx}
      >
        <SettingsField
          id="appearance.tour"
          ctx={fieldCtx}
          control={
            <button
              type="button"
              className={settingsBtnCls}
              onClick={() => reopenOnboardingTour()}
            >
              {t('settings.appearance.tour.action')}
            </button>
          }
        />
      </SettingsGroupFor>

      <SettingsGroupFor
        section="appearance"
        group="字級"
        titleKey="settings.appearance.group.fontSize"
        ctx={fieldCtx}
      >
        <SettingsField
          id="appearance.uiFontSize"
          ctx={fieldCtx}
          description={`${settings.uiFontSize ?? 14}px`}
          control={
            <input
              type="range"
              aria-label={t('settings.appearance.uiFontSize.label')}
              min={12}
              max={18}
              value={settings.uiFontSize ?? 14}
              onChange={(e) => set({ uiFontSize: Number(e.target.value) })}
              className="w-36 accent-primary"
            />
          }
        />
        <SettingsField
          id="appearance.codeFontSize"
          ctx={fieldCtx}
          description={`${settings.codeFontSize ?? 13}px`}
          control={
            <input
              type="range"
              aria-label={t('settings.appearance.codeFontSize.label')}
              min={11}
              max={16}
              value={settings.codeFontSize ?? 13}
              onChange={(e) => set({ codeFontSize: Number(e.target.value) })}
              className="w-36 accent-primary"
            />
          }
        />
      </SettingsGroupFor>
    </>
  )
}
