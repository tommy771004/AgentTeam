import type { LlmSettings, ReducedMotionPreference, ThemePreference } from '../../../agent/types'
import { reopenOnboardingTour } from '../../OnboardingTour'
import { PillSelect, SettingsToggle, settingsBtnCls } from '../SettingsChrome'
import {
  SettingsField,
  SettingsGroupFor,
  type SettingsFieldContext,
} from '../SettingsField'

/**
 * Settings registry restructure（spec 3/6 ticket 01）— 外觀節。
 *
 * 第一個完整走 registry 的節：哪幾列會出現由 metadata 的 tier 決定，這裡只提供
 * 控件本身。群組若在目前檢視下一列都不剩，整張卡就不畫，免得留下空殼標題。
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
  return (
    <>
      <SettingsGroupFor section="appearance" group="主題" ctx={fieldCtx}>
          <SettingsField
            id="appearance.theme"
            ctx={fieldCtx}
            control={
              <PillSelect
                value={settings.theme || 'dark'}
                onChange={(v) => set({ theme: v as ThemePreference })}
              >
                <option value="dark">深色</option>
                <option value="light">淺色</option>
                <option value="system">系統</option>
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
                <option value="system">系統</option>
                <option value="on">開啟</option>
                <option value="off">關閉</option>
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

      <SettingsGroupFor section="appearance" group="導覽" ctx={fieldCtx}>
          <SettingsField
            id="appearance.tour"
            ctx={fieldCtx}
            control={
              <button
                type="button"
                className={settingsBtnCls}
                onClick={() => reopenOnboardingTour()}
              >
                重新導覽
              </button>
            }
          />
      </SettingsGroupFor>

      <SettingsGroupFor section="appearance" group="字級" ctx={fieldCtx}>
          <SettingsField
            id="appearance.uiFontSize"
            ctx={fieldCtx}
            description={`${settings.uiFontSize ?? 14}px`}
            control={
              <input
                type="range"
                aria-label="介面字級"
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
                aria-label="程式碼字級"
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
