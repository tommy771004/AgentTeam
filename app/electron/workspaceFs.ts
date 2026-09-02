/**
 * Pure workspace filesystem helpers (Electron main).
 *
 * `listWorkspaceDirectory` is intentionally read-only: missing paths return a
 * typed not-found result and never mkdir (execution-trust-and-safety / 03).
 * Creating directories remains an explicit write (`workspace_mkdir`).
 */

import fs from 'node:fs'
import path from 'node:path'

export type WorkspaceDirEntry = {
  name: string
  dir: boolean
}

export type WorkspaceListSuccess = {
  ok: true
  path: string
  entries: WorkspaceDirEntry[]
  projectRoot?: string | null
}

export type WorkspaceListNotFound = {
  ok: false
  path: string
  error: 'not-found'
  message: string
  /** Present for naive callers that only read `.entries`. */
  entries: []
  projectRoot?: string | null
}

export type WorkspaceListResult = WorkspaceListSuccess | WorkspaceListNotFound

export type WorkspaceSearchMatch = {
  path: string
  line: number
  text: string
}

export type WorkspaceSearchResult = {
  ok: boolean
  root: string
  matches: WorkspaceSearchMatch[]
  files: string[]
  truncated: boolean
  error?: string
}

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules'])
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_GREP_RESULTS = 25
const DEFAULT_GLOB_RESULTS = 100
const MAX_MATCH_TEXT_CHARS = 300

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '') || '.'
}

function walkFiles(baseDir: string, maxFiles = 4_000): string[] {
  const result: string[] = []
  const visit = (dir: string) => {
    if (result.length >= maxFiles) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (result.length >= maxFiles) return
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        visit(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        result.push(path.join(dir, entry.name))
      }
    }
  }
  visit(baseDir)
  return result
}

function globToRegExp(pattern: string): RegExp {
  const source = normalizeRelative(pattern).split('').reduce((out, char, index, chars) => {
    if (char === '*' && chars[index + 1] === '*') return out + '§DOUBLE§'
    if (char === '*' && chars[index - 1] === '*') return out
    if (char === '?') return out + '[^/]'
    if (char === '.') return out + '\\.'
    return out + char.replace(/[\\^$+{}()[\]|]/g, '\\$&')
  }, '').replace(/\*/g, '[^/]*').replace(/§DOUBLE§\//g, '(?:.*/)?').replace(/§DOUBLE§/g, '.*')
  return new RegExp(`^${source}$`, 'i')
}

export function buildRipgrepArgv(query: string, base = '.'): string[] {
  // Keep this argv builder as the explicit future ripgrep seam. `--no-config`
  // prevents a repository/user rg config from changing a tool result.
  return ['--no-config', '--line-number', '--no-heading', '--color', 'never', query, base]
}

export function grepWorkspaceFiles(
  root: string,
  query: string,
  opts: { baseDir?: string; glob?: string; maxResults?: number; maxFiles?: number } = {},
): WorkspaceSearchResult {
  const matches: WorkspaceSearchMatch[] = []
  const files: string[] = []
  const maxResults = Math.max(1, Math.min(500, Math.floor(opts.maxResults || DEFAULT_GREP_RESULTS)))
  const pattern = query.trim()
  if (!pattern) return { ok: false, root, matches, files, truncated: false, error: 'query is required' }
  let matcher: RegExp
  try { matcher = new RegExp(pattern, 'i') } catch (error) {
    return { ok: false, root, matches, files, truncated: false, error: `invalid regex: ${error instanceof Error ? error.message : String(error)}` }
  }
  const glob = opts.glob?.trim() ? globToRegExp(opts.glob) : null
  const base = opts.baseDir || root
  let truncated = false
  for (const file of walkFiles(base, opts.maxFiles || 4_000)) {
    const relative = normalizeRelative(path.relative(root, file))
    if (glob && !glob.test(relative)) continue
    let stat: fs.Stats
    try { stat = fs.statSync(file) } catch { continue }
    if (stat.size > MAX_SEARCH_FILE_BYTES) continue
    let content: string
    try { content = fs.readFileSync(file, 'utf8') } catch { continue }
    if (content.includes('\u0000')) continue
    let fileMatched = false
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      if (!matcher.test(lines[index])) continue
      fileMatched = true
      if (matches.length >= maxResults) { truncated = true; break }
      matches.push({ path: relative, line: index + 1, text: lines[index].slice(0, MAX_MATCH_TEXT_CHARS) })
    }
    if (fileMatched) files.push(relative)
    if (truncated) break
  }
  return { ok: true, root, matches, files: [...new Set(files)], truncated }
}

export function globWorkspaceFiles(
  root: string,
  pattern: string,
  opts: { baseDir?: string; maxResults?: number; maxFiles?: number } = {},
): WorkspaceSearchResult {
  const matches: WorkspaceSearchMatch[] = []
  const files: string[] = []
  const maxResults = Math.max(1, Math.min(1_000, Math.floor(opts.maxResults || DEFAULT_GLOB_RESULTS)))
  if (!pattern.trim()) return { ok: false, root, matches, files, truncated: false, error: 'pattern is required' }
  const matcher = globToRegExp(pattern)
  let truncated = false
  for (const file of walkFiles(opts.baseDir || root, opts.maxFiles || 4_000)) {
    const relative = normalizeRelative(path.relative(root, file))
    if (!matcher.test(relative)) continue
    if (files.length >= maxResults) { truncated = true; break }
    files.push(relative)
  }
  return { ok: true, root, matches, files, truncated }
}

export type WorkspaceFsApi = {
  existsSync: (p: string) => boolean
  statSync: (p: string) => { isDirectory: () => boolean }
  readdirSync: (
    p: string,
    opts: { withFileTypes: true },
  ) => Array<{ name: string; isDirectory: () => boolean }>
}

/**
 * List one absolute directory without creating it.
 * `relPath` is the caller-facing relative path returned in the result.
 */
export function listWorkspaceDirectory(
  absoluteDir: string,
  relPath: string,
  opts: { projectRoot?: string | null; fs?: WorkspaceFsApi } = {},
): WorkspaceListResult {
  const io = opts.fs ?? fs
  const projectRoot = opts.projectRoot

  if (!io.existsSync(absoluteDir)) {
    return {
      ok: false,
      path: relPath,
      error: 'not-found',
      message: `Not found: ${relPath}`,
      entries: [],
      projectRoot,
    }
  }

  try {
    if (!io.statSync(absoluteDir).isDirectory()) {
      return {
        ok: false,
        path: relPath,
        error: 'not-found',
        message: `Not a directory: ${relPath}`,
        entries: [],
        projectRoot,
      }
    }
  } catch {
    return {
      ok: false,
      path: relPath,
      error: 'not-found',
      message: `Not found: ${relPath}`,
      entries: [],
      projectRoot,
    }
  }

  const entries = io
    .readdirSync(absoluteDir, { withFileTypes: true })
    .map((d) => ({
      name: d.name,
      dir: d.isDirectory(),
    }))

  return {
    ok: true,
    path: relPath,
    entries,
    projectRoot,
  }
}
