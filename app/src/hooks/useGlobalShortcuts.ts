import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { requestFocusComposer } from '../store/commandHistoryStore'
import { useWorkspaceUiStore } from '../store/workspaceUiStore'
import { chordMatches, useShortcutStore } from '../store/shortcutStore'

/**
 * Global shortcuts (Codex / Claude Code style) — chords from shortcutStore.
 * - slashMenu  → open slash command menu
 * - focusComposer → focus composer
 * - toggleConsole → toggle floating console
 * - newThread → new conversation
 * - Escape → close float if open (when not in input)
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const floatOpen = useWorkspaceUiStore((s) => s.floatOpen)
  const setFloatOpen = useWorkspaceUiStore((s) => s.setFloatOpen)
  const setLayoutMode = useWorkspaceUiStore((s) => s.setLayoutMode)
  const toggleCompact = useWorkspaceUiStore((s) => s.toggleCompact)
  const setComposer = useWorkspaceUiStore((s) => s.setComposer)
  const composer = useWorkspaceUiStore((s) => s.composer)
  const effective = useShortcutStore((s) => s.effective)
  const bindings = useShortcutStore((s) => s.bindings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      // Don't steal keys while capturing a new shortcut
      if (target?.closest?.('[data-shortcut-capture]')) return

      const slash = effective('slashMenu')
      const focus = effective('focusComposer')
      const consoleChord = effective('toggleConsole')
      const newThread = effective('newThread')
      const paletteChord = effective('commandPalette')

      if (chordMatches(e, paletteChord)) {
        e.preventDefault()
        void import('../store/paletteStore').then(({ usePaletteStore }) => {
          usePaletteStore.getState().setOpen(true)
        })
        return
      }

      if (chordMatches(e, slash)) {
        e.preventDefault()
        const onHome = location.pathname === '/' || location.pathname === ''
        if (onHome) {
          requestFocusComposer({ openSlash: true })
        } else {
          if (!composer.startsWith('/')) setComposer('/')
          setLayoutMode('float')
          setFloatOpen(true)
          requestAnimationFrame(() => {
            const el = document.querySelector(
              '[data-composer] textarea',
            ) as HTMLTextAreaElement | null
            el?.focus()
          })
        }
        return
      }

      if (chordMatches(e, consoleChord)) {
        e.preventDefault()
        toggleCompact()
        return
      }

      if (chordMatches(e, focus)) {
        e.preventDefault()
        if (location.pathname !== '/' && location.pathname !== '') {
          navigate('/')
          requestAnimationFrame(() => requestFocusComposer({ openSlash: false }))
        } else {
          requestFocusComposer({ openSlash: false })
        }
        return
      }

      if (chordMatches(e, newThread)) {
        e.preventDefault()
        navigate('/')
        void import('../store/threadStore').then(({ useThreadStore }) => {
          useThreadStore.getState().createThread()
        })
        void import('../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setDraftInput('')
        })
        useWorkspaceUiStore.getState().setComposer('')
        requestAnimationFrame(() => requestFocusComposer({ openSlash: false }))
        return
      }

      if (e.key === 'Escape' && floatOpen && !inEditable) {
        setFloatOpen(false)
        setLayoutMode('full')
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    floatOpen,
    setFloatOpen,
    setLayoutMode,
    toggleCompact,
    location.pathname,
    navigate,
    setComposer,
    composer,
    effective,
    bindings,
  ])
}
