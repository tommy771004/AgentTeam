import { useState } from 'react'
import { useLearningStore } from '../../../store/learningStore'
import type { LlmSettings } from '../../../agent/types'
import {
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  SettingsToggle,
  settingsBtnCls,
  settingsBtnPrimaryCls,
  settingsInputCls,
} from '../SettingsChrome'
import { SettingsField, type SettingsFieldContext } from '../SettingsField'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 記憶節。記憶清單與新增草稿只有這一節在用，一併搬進來。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function MemoryPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const { t } = useTranslation()
  const memory = useLearningStore((s) => s.memory)
  const deleteMemoryEntry = useLearningStore((s) => s.deleteMemoryEntry)
  const clearMemories = useLearningStore((s) => s.clearMemories)
  const appendMemory = useLearningStore((s) => s.appendMemory)
  const setUserProfile = useLearningStore((s) => s.setUserProfile)
  const [newMemory, setNewMemory] = useState('')

  return (
    <>
          <SettingsGroup title={t('settings.memory.04c048')}>
            <SettingsField
              id="memory.memoryEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.memoryEnabled !== false}
                  onChange={(v) => set({ memoryEnabled: v })}
                />
              }
            />
            <SettingsField
              id="memory.memoryWriteEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.memoryWriteEnabled !== false}
                  onChange={(v) => set({ memoryWriteEnabled: v })}
                />
              }
            />
            <SettingsField
              id="memory.referenceChatHistory"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.referenceChatHistory !== false}
                  onChange={(v) => set({ referenceChatHistory: v })}
                />
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.memory.0e6f38')}>
            <SettingsStack title="USER profile" description={t('settings.memory.0ec624')}>
              <textarea
                className={settingsInputCls + ' min-h-[80px] resize-y'}
                value={memory.userProfile || ''}
                onChange={(e) => void setUserProfile(e.target.value)}
                placeholder={t('settings.memory.22232f')}
              />
            </SettingsStack>
          </SettingsGroup>
          <SettingsGroup
            title={t('settings.memory.afd998')}
            action={
              <button
                type="button"
                className={settingsBtnCls + ' text-error border-error/30'}
                onClick={() => {
                  if (confirm(t('settings.memory.941cd3'))) void clearMemories()
                }}
              >
                {t('settings.memory.2e9ab4')}
              </button>
            }
          >
            <SettingsStack title={t('settings.memory.2cd9e6')} description={t('settings.memory.9fb328')}>
              <div className="flex gap-2">
                <input
                  className={settingsInputCls + ' flex-1'}
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder={t('settings.memory.d4c904')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newMemory.trim()) {
                      void appendMemory(newMemory.trim()).then(() => setNewMemory(''))
                    }
                  }}
                />
                <button
                  type="button"
                  className={settingsBtnPrimaryCls + ' shrink-0'}
                  onClick={() => {
                    if (!newMemory.trim()) return
                    void appendMemory(newMemory.trim()).then(() => setNewMemory(''))
                  }}
                >
                  {t('settings.memory.2cd9e6')}
                </button>
              </div>
            </SettingsStack>
            {(memory.entries || []).length === 0 ? (
              <div className="px-4 py-4 text-[12px] text-outline">{t('settings.memory.f1e2fe')}</div>
            ) : (
              (memory.entries || []).slice(0, 40).map((e) => (
                <SettingsRow
                  key={e.id}
                  title={e.text}
                  description={e.createdAt?.slice(0, 19).replace('T', ' ')}
                  align="start"
                  control={
                    <button
                      type="button"
                      className="text-[12px] text-error font-medium px-2"
                      onClick={() => void deleteMemoryEntry(e.id)}
                    >
                      {t('settings.memory.a48f5d')}
                    </button>
                  }
                />
              ))
            )}
          </SettingsGroup>
    </>
  )
}
