/**
 * User-customizable keyboard shortcuts (ChatGPT-style settings).
 * Stored locally; empty value = use default.
 */
import { create } from 'zustand'

const KEY = 'subagents.shortcuts.v1'

export type ShortcutId =
  | 'slashMenu'
  | 'focusComposer'
  | 'toggleConsole'
  | 'newThread'

export type ShortcutBinding = {
  id: ShortcutId
  label: string
  description: string
  /** e.g. "Meta+/" "Meta+k" "Meta+." "Meta+n" */
  defaultChord: string
  /** User override chord or empty = default */
  chord: string
}

const DEFAULTS: Omit<ShortcutBinding, 'chord'>[] = [
  {
    id: 'slashMenu',
    label: '指令選單',
    description: '開啟 / 指令列表',
    defaultChord: 'Meta+/',
  },
  {
    id: 'focusComposer',
    label: '聚焦輸入',
    description: '回到主輸入框',
    defaultChord: 'Meta+k',
  },
  {
    id: 'toggleConsole',
    label: '浮動控制台',
    description: '開關迷你控制台',
    defaultChord: 'Meta+.',
  },
  {
    id: 'newThread',
    label: '新對話',
    description: '建立新 thread',
    defaultChord: 'Meta+n',
  },
]

function loadMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

function saveMap(m: Record<string, string>) {
  localStorage.setItem(KEY, JSON.stringify(m))
}

function buildList(overrides: Record<string, string>): ShortcutBinding[] {
  return DEFAULTS.map((d) => ({
    ...d,
    chord: overrides[d.id] || '',
  }))
}

interface ShortcutStore {
  bindings: ShortcutBinding[]
  /** Set override chord (empty string = reset to default) */
  setChord: (id: ShortcutId, chord: string) => void
  resetAll: () => void
  /** Effective chord for id */
  effective: (id: ShortcutId) => string
}

export const useShortcutStore = create<ShortcutStore>((set, get) => {
  const overrides = loadMap()
  return {
    bindings: buildList(overrides),
    setChord: (id, chord) => {
      const m = loadMap()
      const cleaned = chord.trim()
      if (!cleaned) delete m[id]
      else m[id] = cleaned
      saveMap(m)
      set({ bindings: buildList(m) })
    },
    resetAll: () => {
      saveMap({})
      set({ bindings: buildList({}) })
    },
    effective: (id) => {
      const b = get().bindings.find((x) => x.id === id)
      return (b?.chord || b?.defaultChord || '').trim()
    },
  }
})

/** Parse chord like "Meta+/" "Ctrl+Shift+k" "Meta+." */
export function chordMatches(e: KeyboardEvent, chord: string): boolean {
  const parts = chord
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (!parts.length) return false

  const needMeta =
    parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
  const needCtrl = parts.includes('ctrl') || parts.includes('control')
  const needAlt = parts.includes('alt') || parts.includes('option')
  const needShift = parts.includes('shift')
  const keyPart = parts.find(
    (p) =>
      !['meta', 'cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'shift'].includes(
        p,
      ),
  )
  if (!keyPart) return false

  // Meta chords accept Cmd (Mac) or Ctrl (Win/Linux)
  if (needMeta) {
    if (!(e.metaKey || e.ctrlKey)) return false
  } else if (needCtrl) {
    if (!e.ctrlKey) return false
  } else if (e.metaKey || e.ctrlKey) {
    return false
  }

  if (needAlt !== e.altKey) return false
  if (needShift !== e.shiftKey) return false

  const k = e.key.toLowerCase()
  const code = e.code.toLowerCase()
  if (keyPart === '/' || keyPart === 'slash') {
    return k === '/' || code === 'slash'
  }
  if (keyPart === '.') {
    return k === '.' || code === 'period'
  }
  if (keyPart === 'escape' || keyPart === 'esc') {
    return k === 'escape'
  }
  return k === keyPart || code === `key${keyPart}`
}

/** Format chord for display */
export function formatChord(chord: string): string {
  return chord
    .split('+')
    .map((p) => {
      const x = p.trim()
      if (/^meta|cmd|command$/i.test(x)) return '⌘'
      if (/^ctrl|control$/i.test(x)) return 'Ctrl'
      if (/^alt|option$/i.test(x)) return '⌥'
      if (/^shift$/i.test(x)) return '⇧'
      return x.length === 1 ? x.toUpperCase() : x
    })
    .join(' + ')
}

/** Build chord string from a KeyboardEvent (for capture UI) */
export function eventToChord(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  const parts: string[] = []
  if (e.metaKey) parts.push('Meta')
  else if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.key === '/') parts.push('/')
  else if (e.key === '.') parts.push('.')
  else if (e.key.length === 1) parts.push(e.key.toLowerCase())
  else parts.push(e.key)
  if (parts.length < 2 && !['Escape'].includes(e.key)) return null
  return parts.join('+')
}
