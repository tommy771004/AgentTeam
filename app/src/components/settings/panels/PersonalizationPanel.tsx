import type { LlmSettings, PersonalityPreset } from '../../../agent/types'
import { PillSelect, SettingsGroup, settingsInputCls } from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'

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
  return (
    <>
          <SettingsGroup title="人格">
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
                  <option value="default">預設</option>
                  <option value="none">無（中性）</option>
                  <option value="friendly">友善</option>
                  <option value="efficient">務實精簡</option>
                  <option value="professional">專業</option>
                  <option value="candid">直率</option>
                  <option value="quirky">俏皮</option>
                </PillSelect>
              }
            />
          </SettingsGroup>
          <SettingsGroup title="自訂指令">
            <SettingsField id="personalization.customAboutUser" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[96px] resize-y'}
                value={settings.customAboutUser || ''}
                onChange={(e) => set({ customAboutUser: e.target.value })}
                placeholder="寫下希望代理知道的背景…"
              />
            </SettingsField>
            <SettingsField id="personalization.customResponseStyle" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[96px] resize-y'}
                value={settings.customResponseStyle || ''}
                onChange={(e) =>
                  set({ customResponseStyle: e.target.value })
                }
                placeholder="例如：先結論再步驟、繁中、少 emoji…"
              />
            </SettingsField>
          </SettingsGroup>
    </>
  )
}
