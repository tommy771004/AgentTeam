/**
 * Project folder pick + Git branch / worktree discovery
 */

import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { runBash } from './shellBridge'

export type GitWorktree = {
  path: string
  branch: string
  bare: boolean
  detached: boolean
}

export type ProjectGitInfo = {
  root: string
  name: string
  isGit: boolean
  branch: string | null
  remote: string | null
  worktrees: GitWorktree[]
  dirty: boolean
}

export type PickFolderResult = {
  canceled: boolean
  path: string | null
  error?: string
}

/**
 * Open native OS folder picker (Finder / Explorer).
 * Prefer attaching to parent window so dialog is modal on top of the app.
 */
export async function pickProjectFolder(
  parent?: BrowserWindow | null,
  defaultPath?: string,
): Promise<PickFolderResult> {
  const start =
    (defaultPath && fs.existsSync(defaultPath) && defaultPath) ||
    app.getPath('home')

  const opts: Electron.OpenDialogOptions = {
    // createDirectory: macOS allows "New Folder" in the sheet
    properties: ['openDirectory', 'createDirectory'],
    title: '選擇專案目錄',
    buttonLabel: '選擇此資料夾',
    defaultPath: start,
  }

  try {
    const win =
      (parent && !parent.isDestroyed() ? parent : null) ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ||
      null

    // Ensure host window is on-screen before modal sheet (macOS)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
      // Let focus settle — calling showOpenDialog in the same tick as focus
      // sometimes fails to raise the sheet on macOS.
      await new Promise((r) => setTimeout(r, 30))
    }

    let res: Electron.OpenDialogReturnValue
    try {
      res = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
    } catch (first) {
      // Retry without parent (non-sheet floating dialog) if modal form fails
      console.warn('[project:pick] modal dialog failed, retrying free-standing:', first)
      res = await dialog.showOpenDialog(opts)
    }

    if (res.canceled || !res.filePaths?.[0]) {
      return { canceled: true, path: null }
    }
    const chosen = res.filePaths[0]
    if (!fs.existsSync(chosen)) {
      return { canceled: false, path: null, error: `路徑不存在：${chosen}` }
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(chosen)
    } catch (e) {
      return {
        canceled: false,
        path: null,
        error: e instanceof Error ? e.message : String(e),
      }
    }
    if (!stat.isDirectory()) {
      return { canceled: false, path: null, error: `不是資料夾：${chosen}` }
    }
    return { canceled: false, path: chosen }
  } catch (e) {
    console.error('[project:pick] failed:', e)
    return {
      canceled: false,
      path: null,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function inspectProject(root: string): Promise<ProjectGitInfo> {
  const name = path.basename(root) || root
  if (!root || !fs.existsSync(root)) {
    return {
      root: root || '',
      name: name || '—',
      isGit: false,
      branch: null,
      remote: null,
      worktrees: [],
      dirty: false,
    }
  }

  const gitCheck = await runBash({
    command: 'git rev-parse --is-inside-work-tree',
    cwd: root,
    timeoutMs: 5000,
  })
  const isGit = gitCheck.ok && gitCheck.stdout.trim() === 'true'

  if (!isGit) {
    return {
      root,
      name,
      isGit: false,
      branch: null,
      remote: null,
      worktrees: [],
      dirty: false,
    }
  }

  const branchR = await runBash({
    command: 'git rev-parse --abbrev-ref HEAD',
    cwd: root,
    timeoutMs: 5000,
  })
  const branch = branchR.stdout.trim() || null

  const remoteR = await runBash({
    command: 'git remote get-url origin',
    cwd: root,
    timeoutMs: 5000,
  })
  const remote = remoteR.stdout.trim() || null

  const dirtyR = await runBash({
    command: 'git status --porcelain',
    cwd: root,
    timeoutMs: 8000,
  })
  const dirty = Boolean(dirtyR.stdout.trim())

  const wtR = await runBash({
    command: 'git worktree list --porcelain',
    cwd: root,
    timeoutMs: 8000,
  })
  const worktrees = parseWorktreePorcelain(wtR.stdout)

  return {
    root,
    name,
    isGit: true,
    branch: branch === 'HEAD' ? 'detached' : branch,
    remote,
    worktrees: worktrees.length
      ? worktrees
      : [
          {
            path: root,
            branch: branch || 'main',
            bare: false,
            detached: branch === 'HEAD',
          },
        ],
    dirty,
  }
}

function parseWorktreePorcelain(text: string): GitWorktree[] {
  const blocks = text.trim().split(/\n\n+/)
  const out: GitWorktree[] = []
  for (const b of blocks) {
    const lines = b.split('\n')
    let p = ''
    let branch = ''
    let bare = false
    let detached = false
    for (const line of lines) {
      if (line.startsWith('worktree ')) p = line.slice(9)
      else if (line.startsWith('branch '))
        branch = line.slice(7).replace(/^refs\/heads\//, '')
      else if (line === 'bare') bare = true
      else if (line === 'detached') detached = true
      else if (line.startsWith('HEAD ') && !branch) detached = true
    }
    if (p) {
      out.push({
        path: p,
        branch: branch || (detached ? 'detached' : 'main'),
        bare,
        detached,
      })
    }
  }
  return out
}

export async function listBranches(root: string): Promise<string[]> {
  const r = await runBash({
    command: 'git branch --format="%(refname:short)"',
    cwd: root,
    timeoutMs: 8000,
  })
  if (!r.ok) return []
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)
}
