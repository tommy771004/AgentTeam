/**
 * Pure workspace filesystem helpers (Electron main).
 *
 * `listWorkspaceDirectory` is intentionally read-only: missing paths return a
 * typed not-found result and never mkdir (execution-trust-and-safety / 03).
 * Creating directories remains an explicit write (`workspace_mkdir`).
 */

import fs from 'node:fs'

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
