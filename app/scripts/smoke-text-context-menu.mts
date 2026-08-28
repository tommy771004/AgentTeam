import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  contextMenuSelectionPreview,
  googleSelectionSearchUrl,
  textContextMenuTemplate,
} from '../electron/textContextMenu.ts'

const editFlags = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: true,
  canPaste: false,
  canDelete: false,
  canSelectAll: true,
  canEditRichly: false,
}
const calls: string[] = []
const actions = {
  lookUpSelection: () => calls.push('lookup'),
  searchWithGoogle: (selection: string) => calls.push(`search:${selection}`),
}

const longSelection = '呼叫內容與執行結果分開保存，不再發生搜尋條件蓋掉訊息。'
const mac = textContextMenuTemplate({ isEditable: false, selectionText: longSelection, editFlags }, 'darwin', actions)
assert.match(String(mac[0].label), /^Look Up “呼叫內容與執行結果分開保.*…”$/)
assert.deepEqual(mac.slice(1).map((item) => item.role || item.type || item.label), ['Search with Google', 'separator', 'copy'])
;(mac[0].click as (() => void))()
;(mac[1].click as (() => void))()
assert.deepEqual(calls, ['lookup', `search:${longSelection}`])

const windows = textContextMenuTemplate({ isEditable: false, selectionText: 'selected text', editFlags }, 'win32', actions)
assert.deepEqual(windows.map((item) => item.role || item.type || item.label), ['Search with Google', 'separator', 'copy'])
assert.deepEqual(textContextMenuTemplate({ isEditable: false, selectionText: ' ', editFlags }, 'darwin', actions), [])

const editable = textContextMenuTemplate({ isEditable: true, selectionText: '', editFlags: { ...editFlags, canPaste: true } }, 'darwin', actions)
assert.deepEqual(editable.map((item) => item.role || item.type), [
  'undo', 'redo', 'separator', 'cut', 'paste', 'delete', 'separator', 'selectAll',
])
assert.equal(editable.find((item) => item.role === 'paste')?.enabled, true)

assert.equal(contextMenuSelectionPreview(' one\n two  three '), 'one two three')
const search = new URL(googleSelectionSearchUrl('a+b & 中文'))
assert.equal(search.origin, 'https://www.google.com')
assert.equal(search.pathname, '/search')
assert.equal(search.searchParams.get('q'), 'a+b & 中文')
assert.equal(new URL(googleSelectionSearchUrl('x'.repeat(2_500))).searchParams.get('q')?.length, 1_800)

const main = await readFile(resolve(import.meta.dirname, '../electron/main.ts'), 'utf8')
assert.match(main, /webContents\.on\('context-menu'/, 'the native WebContents event owns right-click behavior')
assert.match(main, /showDefinitionForSelection\(\)/, 'Look Up delegates to the macOS dictionary service')
assert.match(main, /shell\.openExternal\(googleSelectionSearchUrl\(selection\)\)/,
  'Google search opens only after the menu action is clicked')
assert.doesNotMatch(main, /Google search failed['"], error/,
  'an openExternal failure must not log the URL containing selected text')
assert.match(main, /Menu\.buildFromTemplate\(template\)\.popup\(/,
  'the menu is native Electron UI rather than a renderer imitation')

console.log('native text context menu supports Look Up, Google search, Copy, and editable text commands')
