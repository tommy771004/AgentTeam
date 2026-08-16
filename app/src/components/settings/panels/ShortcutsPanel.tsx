import { useEffect, useState } from 'react'
import { eventToChord, formatChord, useShortcutStore } from '../../../store/shortcutStore'
import { SettingsGroup, SettingsRow, settingsBtnCls } from '../SettingsChrome'
import type { LlmSettings } from '../../../agent/types'
import { useTranslation } from '../../../i18n/useTranslation'

/**
 * Settings registry restructure（spec 3/6）— 鍵盤快捷鍵節。錄製狀態只有這一節在用，一併搬進來。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function ShortcutsPanel({
  settings,
}: {
  settings: LlmSettings
}) {
  const { t } = useTranslation()
  const shortcutBindings = useShortcutStore((s) => s.bindings)
  const setShortcutChord = useShortcutStore((s) => s.setChord)
  const resetShortcuts = useShortcutStore((s) => s.resetAll)
  const [capturingId, setCapturingId] = useState<string | null>(null)

  // 錄製新的快捷鍵組合
  useEffect(() => {
    if (!capturingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingId(null)
        return
      }
      const chord = eventToChord(e)
      if (!chord) return
      setShortcutChord(
        capturingId as 'slashMenu' | 'focusComposer' | 'toggleConsole' | 'newThread',
        chord,
      )
      setCapturingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingId, setShortcutChord])

  return (
    <>
          <SettingsGroup
            title={t('settings.shortcuts.f62bab')}
            action={
              <button
                type="button"
                className={settingsBtnCls}
                onClick={() => resetShortcuts()}
              >
                {t('settings.shortcuts.e9d976')}
              </button>
            }
          >
            {shortcutBindings.map((b) => {
              const shown = formatChord(b.chord || b.defaultChord)
              const capturing = capturingId === b.id
              return (
                <SettingsRow
                  key={b.id}
                  title={b.label}
                  description={
                    b.chord
                      ? `${b.description} · 預設 ${formatChord(b.defaultChord)}`
                      : b.description
                  }
                  control={
                    <div className="flex items-center gap-2" data-shortcut-capture>
                      <button
                        type="button"
                        className={`text-[11px] px-2.5 py-1 rounded-full border font-[family-name:var(--font-mono)] ${
                          capturing
                            ? 'border-primary/50 text-primary bg-primary/10'
                            : 'bg-white/[0.06] border-white/10 text-on-surface-variant hover:border-primary/40'
                        }`}
                        onClick={() => setCapturingId(capturing ? null : b.id)}
                        title={t('settings.shortcuts.90f65c')}
                      >
                        {capturing ? t('settings.shortcuts.3faf37') : shown}
                      </button>
                      {b.chord ? (
                        <button
                          type="button"
                          className="text-[11px] text-outline hover:text-error"
                          onClick={() => setShortcutChord(b.id, '')}
                        >
                          {t('settings.shortcuts.76eb96')}
                        </button>
                      ) : null}
                    </div>
                  }
                />
              )
            })}
          </SettingsGroup>
          <SettingsGroup title={t('settings.shortcuts.4ce656')}>
            {(
              [
                [
                  settings.enterBehavior === 'cmdEnter' ? '⌘ / Ctrl + Enter' : 'Enter',
                  t('settings.shortcuts.b5ba55'),
                ],
                [
                  settings.enterBehavior === 'cmdEnter' ? 'Enter' : 'Shift + Enter',
                  t('settings.shortcuts.91eb82'),
                ],
                ['↑ / ↓', t('settings.shortcuts.dbe2c4')],
                ['Esc', t('settings.shortcuts.ba0c35')],
              ] as const
            ).map(([k, v]) => (
              <SettingsRow
                key={k + v}
                title={v}
                control={
                  <kbd className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 font-[family-name:var(--font-mono)] text-on-surface-variant">
                    {k}
                  </kbd>
                }
              />
            ))}
          </SettingsGroup>
    </>
  )
}
