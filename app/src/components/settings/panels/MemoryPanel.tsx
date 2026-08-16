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
  const memory = useLearningStore((s) => s.memory)
  const deleteMemoryEntry = useLearningStore((s) => s.deleteMemoryEntry)
  const clearMemories = useLearningStore((s) => s.clearMemories)
  const appendMemory = useLearningStore((s) => s.appendMemory)
  const setUserProfile = useLearningStore((s) => s.setUserProfile)
  const [newMemory, setNewMemory] = useState('')

  return (
    <>
          <SettingsGroup title="記憶控制">
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
          <SettingsGroup title="使用者檔案">
            <SettingsStack title="USER profile" description="穩定自我介紹／角色">
              <textarea
                className={settingsInputCls + ' min-h-[80px] resize-y'}
                value={memory.userProfile || ''}
                onChange={(e) => void setUserProfile(e.target.value)}
                placeholder="會優先進入提示…"
              />
            </SettingsStack>
          </SettingsGroup>
          <SettingsGroup
            title="已存記憶"
            action={
              <button
                type="button"
                className={settingsBtnCls + ' text-error border-error/30'}
                onClick={() => {
                  if (confirm('確定清除所有記憶與使用者檔案？')) void clearMemories()
                }}
              >
                清除全部
              </button>
            }
          >
            <SettingsStack title="新增" description="手動寫入一條記憶">
              <div className="flex gap-2">
                <input
                  className={settingsInputCls + ' flex-1'}
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder="輸入後 Enter 或按新增…"
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
                  新增
                </button>
              </div>
            </SettingsStack>
            {(memory.entries || []).length === 0 ? (
              <div className="px-4 py-4 text-[12px] text-outline">尚無記憶條目</div>
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
                      刪除
                    </button>
                  }
                />
              ))
            )}
          </SettingsGroup>
    </>
  )
}
