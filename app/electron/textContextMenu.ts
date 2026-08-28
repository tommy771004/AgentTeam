import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

type TextContextMenuInput = Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>

export type TextContextMenuActions = {
  lookUpSelection: () => void
  searchWithGoogle: (selection: string) => void
}

const LOOK_UP_PREVIEW_WIDTH = 36
const SEARCH_SELECTION_LIMIT = 1_800

function glyphWidth(glyph: string): number {
  return /[\u2E80-\u9FFF\uF900-\uFAFF]/u.test(glyph) ? 2 : 1
}

/** A one-line, display-width-bounded preview for the native Look Up label. */
export function contextMenuSelectionPreview(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  let width = 0
  let preview = ''
  for (const glyph of normalized) {
    const nextWidth = width + glyphWidth(glyph)
    if (nextWidth > LOOK_UP_PREVIEW_WIDTH) return `${preview}…`
    preview += glyph
    width = nextWidth
  }
  return preview
}

/** Fixed-origin search URL; the selected text is added only after an explicit click. */
export function googleSelectionSearchUrl(selection: string): string {
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', [...selection.trim()].slice(0, SEARCH_SELECTION_LIMIT).join(''))
  return url.href
}

function selectedTextItems(
  input: TextContextMenuInput,
  platform: NodeJS.Platform,
  actions: TextContextMenuActions,
): MenuItemConstructorOptions[] {
  const selection = input.selectionText.trim()
  if (!selection) return []
  return [
    ...(platform === 'darwin'
      ? [{ label: `Look Up “${contextMenuSelectionPreview(selection)}”`, click: actions.lookUpSelection }]
      : []),
    { label: 'Search with Google', click: () => actions.searchWithGoogle(selection) },
    { type: 'separator' },
    { role: 'copy', enabled: input.editFlags.canCopy },
  ]
}

function editableTextItems(input: TextContextMenuInput): MenuItemConstructorOptions[] {
  if (!input.isEditable) return []
  return [
    { role: 'undo', enabled: input.editFlags.canUndo },
    { role: 'redo', enabled: input.editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: input.editFlags.canCut },
    { role: 'paste', enabled: input.editFlags.canPaste },
    { role: 'delete', enabled: input.editFlags.canDelete },
    { type: 'separator' },
    { role: 'selectAll', enabled: input.editFlags.canSelectAll },
  ]
}

/**
 * Native menu contents for prose selection and text fields.
 *
 * Selected prose intentionally matches Codex Desktop's compact three-action
 * menu. Editable controls append native editing commands instead of replacing
 * paste/undo behavior with a chat-specific surface.
 */
export function textContextMenuTemplate(
  input: TextContextMenuInput,
  platform: NodeJS.Platform,
  actions: TextContextMenuActions,
): MenuItemConstructorOptions[] {
  const selected = selectedTextItems(input, platform, actions)
  const editable = editableTextItems(input)
  if (!selected.length) return editable
  if (!editable.length) return selected
  return [...selected, { type: 'separator' }, ...editable]
}
