import type { LlmSettings } from '../../../agent/types'
import { SettingsGroup, SettingsToggle, settingsInputCls } from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'

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
  return (
    <>
          <SettingsGroup title="分支與推送">
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
          <SettingsGroup title="指引（注入提示）">
            <SettingsField id="git.gitCommitInstructions" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[72px] resize-y'}
                value={settings.gitCommitInstructions || ''}
                onChange={(e) =>
                  set({ gitCommitInstructions: e.target.value })
                }
                placeholder="例如：conventional commits、中文摘要…"
              />
            </SettingsField>
            <SettingsField id="git.gitPrInstructions" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[72px] resize-y'}
                value={settings.gitPrInstructions || ''}
                onChange={(e) => set({ gitPrInstructions: e.target.value })}
                placeholder="例如：標題簡短、描述含測試計畫…"
              />
            </SettingsField>
          </SettingsGroup>
    </>
  )
}
