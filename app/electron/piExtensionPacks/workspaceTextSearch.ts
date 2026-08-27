import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  globWorkspaceFiles,
  grepWorkspaceFiles,
  type WorkspaceSearchResult,
} from '../workspaceFs.ts'
import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { WORKSPACE_TEXT_SEARCH_CAPABILITY_ID, workspaceTextSearchAvailability } from '../piWorkspaceTextSearchRuntime.ts'
import { structuredFailure } from './packResults.ts'
import { pagedText } from './utility.ts'

const WORKSPACE_GREP_DEFAULT_RESULTS = 25
const WORKSPACE_GLOB_DEFAULT_RESULTS = 100
const WORKSPACE_SEARCH_PAGE_CHARS = 8_000

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolve an optional user-facing base directory while defending both lexical
 * `..` traversal and an existing symlink that resolves outside the workspace.
 */
export function resolveWorkspaceSearchBase(
  workspaceRoot: string,
  requestedBase: unknown,
): { ok: true; root: string; baseDir: string } | { ok: false; reason: string } {
  try {
    const root = realpathSync.native(resolve(workspaceRoot))
    if (!statSync(root).isDirectory()) return { ok: false, reason: 'workspace root is not a directory' }

    const raw = typeof requestedBase === 'string' && requestedBase.trim()
      ? requestedBase.trim()
      : '.'
    const lexical = resolve(root, raw)
    if (!within(root, lexical)) {
      return { ok: false, reason: 'base is outside the admitted workspace' }
    }

    const baseDir = realpathSync.native(lexical)
    if (!statSync(baseDir).isDirectory()) return { ok: false, reason: 'base is not a directory' }
    if (!within(root, baseDir)) {
      return { ok: false, reason: 'base resolves outside the admitted workspace' }
    }
    return { ok: true, root, baseDir }
  } catch {
    return { ok: false, reason: 'base directory does not exist or cannot be read' }
  }
}

function resultPayload(result: WorkspaceSearchResult) {
  return {
    ok: result.ok,
    matches: result.matches,
    files: result.files,
    truncated: result.truncated,
    ...(result.error ? { error: result.error } : {}),
  }
}

function compactLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function formatWorkspaceGrepContent(result: WorkspaceSearchResult): string {
  const header = `workspace_grep 找到 ${result.matches.length} 筆結果${result.truncated ? '（搜尋結果已截斷）' : ''}`
  if (!result.matches.length) return header
  return [header, ...result.matches.map((match) => `${match.path}:${match.line} ${compactLine(match.text)}`)].join('\n')
}

export function formatWorkspaceGlobContent(result: WorkspaceSearchResult): string {
  const header = `workspace_glob 找到 ${result.files.length} 個檔案${result.truncated ? '（搜尋結果已截斷）' : ''}`
  if (!result.files.length) return header
  return [header, ...result.files].join('\n')
}

function pagedWorkspaceResult(text: string, result: WorkspaceSearchResult) {
  const page = pagedText(text, WORKSPACE_SEARCH_PAGE_CHARS)
  return {
    content: page.content,
    details: {
      ...resultPayload(result),
      outputId: page.details.outputId,
      outputTruncated: page.details.truncated,
      totalChars: page.details.totalChars,
    },
  }
}

const workspaceGrep: PiPackTool = {
  name: 'workspace_grep',
  label: 'Workspace Grep',
  description: 'Search text in files inside the admitted workspace using bounded read-only traversal',
  operationClass: 'read',
  promptSnippet: 'search workspace text before reading whole files',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Case-insensitive regular expression' },
      glob: { type: 'string', description: 'Optional workspace-relative file glob' },
      base: { type: 'string', description: 'Optional workspace-relative base directory', default: '.' },
      maxResults: { type: 'integer', minimum: 1, maximum: 500, default: WORKSPACE_GREP_DEFAULT_RESULTS },
      maxFiles: { type: 'integer', minimum: 1, maximum: 4000, default: 4000 },
    },
    required: ['query'],
  },
  execute: async (args, ctx) => {
    // In-turn calls execute inside Pi rather than re-entering tools/pack.
    // The frozen session gate is therefore checked again at the tool itself;
    // direct protocol calls have already passed the same gate in piHostProtocol.
    const runtimeGate = workspaceTextSearchAvailability({
      sessionId: ctx.sessionId,
      enabled: true,
      workspaceRoot: ctx.cwd,
    })
    if (!runtimeGate.available || (ctx.sessionId !== 'direct' && !runtimeGate.frozen)) {
      return structuredFailure(runtimeGate.reason || 'Workspace text search requires an admitted Host run')
    }
    const scoped = resolveWorkspaceSearchBase(ctx.cwd, args.base)
    if (!scoped.ok) return structuredFailure(scoped.reason)
    const result = grepWorkspaceFiles(scoped.root, String(args.query || ''), {
      baseDir: scoped.baseDir,
      glob: typeof args.glob === 'string' ? args.glob : undefined,
      maxResults: Number(args.maxResults) || WORKSPACE_GREP_DEFAULT_RESULTS,
      maxFiles: Number(args.maxFiles) || undefined,
    })
    if (!result.ok) return structuredFailure(result.error || 'workspace grep failed')
    return pagedWorkspaceResult(formatWorkspaceGrepContent(result), result)
  },
}

const workspaceGlob: PiPackTool = {
  name: 'workspace_glob',
  label: 'Workspace Glob',
  description: 'Find file paths inside the admitted workspace using bounded read-only traversal',
  operationClass: 'read',
  promptSnippet: 'narrow the workspace file set before reading file contents',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Workspace-relative glob pattern such as src/**/*.ts' },
      base: { type: 'string', description: 'Optional workspace-relative base directory', default: '.' },
      maxResults: { type: 'integer', minimum: 1, maximum: 1000, default: WORKSPACE_GLOB_DEFAULT_RESULTS },
      maxFiles: { type: 'integer', minimum: 1, maximum: 4000, default: 4000 },
    },
    required: ['pattern'],
  },
  execute: async (args, ctx) => {
    const runtimeGate = workspaceTextSearchAvailability({
      sessionId: ctx.sessionId,
      enabled: true,
      workspaceRoot: ctx.cwd,
    })
    if (!runtimeGate.available || (ctx.sessionId !== 'direct' && !runtimeGate.frozen)) {
      return structuredFailure(runtimeGate.reason || 'Workspace text search requires an admitted Host run')
    }
    const scoped = resolveWorkspaceSearchBase(ctx.cwd, args.base)
    if (!scoped.ok) return structuredFailure(scoped.reason)
    const result = globWorkspaceFiles(scoped.root, String(args.pattern || ''), {
      baseDir: scoped.baseDir,
      maxResults: Number(args.maxResults) || WORKSPACE_GLOB_DEFAULT_RESULTS,
      maxFiles: Number(args.maxFiles) || undefined,
    })
    if (!result.ok) return structuredFailure(result.error || 'workspace glob failed')
    return pagedWorkspaceResult(formatWorkspaceGlobContent(result), result)
  },
}

export function buildWorkspaceTextSearchPack() {
  return {
    id: WORKSPACE_TEXT_SEARCH_CAPABILITY_ID,
    name: 'Workspace Text Search',
    description: 'Bounded read-only workspace grep/glob backed by the existing Electron workspace search helpers',
    capability: WORKSPACE_TEXT_SEARCH_CAPABILITY_ID,
    tools: [workspaceGrep, workspaceGlob],
  }
}

let registered = false
export function ensureWorkspaceTextSearchPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildWorkspaceTextSearchPack())
}
