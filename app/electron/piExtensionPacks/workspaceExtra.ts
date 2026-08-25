import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { registerPiExtensionPack, type PiPackTool, type PiToolContext } from '../piToolHost.ts'
import { withFileMutationQueue } from '../piVendor.ts'
import { structuredFailure, structuredOk } from './packResults.ts'

/**
 * Workspace non-equivalents（工作區非等價工具）.
 *
 * These five have no Pi builtin counterpart (ADR-0027), so they exist as
 * separately named extension tools. Every one that mutates a file takes Pi's
 * `withFileMutationQueue()` on the RESOLVED absolute target — the whole
 * read-modify-write runs inside the queue, not just the final write, or two
 * tools reading the same old content would each write back and the second
 * would erase the first.
 */

function resolveWithin(cwd: string, target: string): string | undefined {
  if (!target.trim()) return undefined
  const root = resolve(cwd)
  const full = resolve(root, target)
  const rel = relative(root, full)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return full
}

/** Scope + resolution in one gate; every tool here starts with it. */
function scopedTarget(ctx: PiToolContext, target: unknown): string | string[] {
  const raw = typeof target === 'string' ? target : ''
  const resolved = resolveWithin(ctx.cwd, raw)
  return resolved || ['path', `${String(target)} is outside the requested project scope`]
}

const workspaceDiff: PiPackTool = {
  name: 'workspace_diff',
  label: 'Workspace Diff',
  description: 'Compare two files inside the project',
  promptSnippet: 'compare two project files and report differing lines',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Baseline file' },
      target: { type: 'string', description: 'Changed file' },
    },
    required: ['source', 'target'],
  },
  policyMigration: { pathArguments: ['source', 'target'] },
  execute: async (args, ctx) => {
    for (const key of ['source', 'target']) {
      const check = scopedTarget(ctx, args[key])
      if (Array.isArray(check)) return structuredFailure(`${key}: ${check[1]}`)
    }
    try {
      const [left, right] = await Promise.all([
        readFile(String(args.source), 'utf8'),
        readFile(String(args.target), 'utf8'),
      ])
      const leftLines = left.split('\n')
      const rightLines = right.split('\n')
      const changes: string[] = []
      const max = Math.max(leftLines.length, rightLines.length)
      for (let index = 0; index < max && changes.length < 200; index += 1) {
        if (leftLines[index] !== rightLines[index]) {
          changes.push(`L${index + 1}: -${JSON.stringify(leftLines[index] ?? '')} +${JSON.stringify(rightLines[index] ?? '')}`)
        }
      }
      const same = left === right
      return structuredOk(same ? '兩個檔案內容相同' : `${changes.length} 處差異`, { same, changes })
    } catch (error) {
      return structuredFailure(error instanceof Error ? error.message : String(error))
    }
  },
}

const workspaceMove: PiPackTool = {
  name: 'workspace_move',
  label: 'Workspace Move',
  description: 'Move or rename a file inside the project',
  promptSnippet: 'move or rename a file within the project',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Current path' },
      target: { type: 'string', description: 'New path' },
    },
    required: ['source', 'target'],
  },
  approval: () => ({ need: true, reason: 'workspace_move 會搬動專案檔案' }),
  policyMigration: { sideEffect: true, pathArguments: ['source', 'target'] },
  execute: async (args, ctx) => {
    const source = scopedTarget(ctx, args.source)
    const target = scopedTarget(ctx, args.target)
    if (Array.isArray(source)) return structuredFailure(`source: ${source[1]}`)
    if (Array.isArray(target)) return structuredFailure(`target: ${target[1]}`)
    // Both endpoints sit in the queue: the move is atomic against any other
    // queued mutation of either path.
    await withFileMutationQueue(source, async () => {
      await withFileMutationQueue(target, () => mkdir(dirname(target), { recursive: true }).then(() => rename(source, target)))
    })
    return structuredOk(`已搬移至 ${target}`, { source, target })
  },
}

const workspaceDelete: PiPackTool = {
  name: 'workspace_delete',
  label: 'Workspace Delete',
  description: 'Delete a file inside the project',
  promptSnippet: 'delete one file inside the project',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'File to delete' } },
    required: ['path'],
  },
  approval: () => ({ need: true, reason: 'workspace_delete 會刪除專案檔案' }),
  policyMigration: { sideEffect: true, pathArguments: ['path'] },
  execute: async (args, ctx) => {
    const target = scopedTarget(ctx, args.path)
    if (Array.isArray(target)) return structuredFailure(`path: ${target[1]}`)
    await withFileMutationQueue(target, () => unlink(target))
    return structuredOk(`已刪除 ${target}`, { deleted: target })
  },
}

const workspaceMkdir: PiPackTool = {
  name: 'workspace_mkdir',
  label: 'Workspace Mkdir',
  description: 'Create a directory inside the project',
  promptSnippet: 'create a directory inside the project',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Directory to create' } },
    required: ['path'],
  },
  policyMigration: { sideEffect: true, pathArguments: ['path'] },
  execute: async (args, ctx) => {
    const target = scopedTarget(ctx, args.path)
    if (Array.isArray(target)) return structuredFailure(`path: ${target[1]}`)
    await withFileMutationQueue(join(target, '.mkdir'), () => mkdir(target, { recursive: true }))
    return structuredOk(`已建立目錄 ${target}`, { created: target })
  },
}

/**
 * Downloads a URL into the project. The fetch is an OUTBOUND read and the
 * write lands in the queue like every other mutation.
 */
const workspaceDownload: PiPackTool = {
  name: 'workspace_download',
  label: 'Workspace Download',
  description: 'Download a URL into a project file',
  promptSnippet: 'download a URL into a project file',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP(S) URL' },
      path: { type: 'string', description: 'Destination path inside the project' },
      maxBytes: { type: 'integer', description: 'Max download size', default: 5_000_000 },
    },
    required: ['url', 'path'],
  },
  approval: () => ({ need: true, reason: 'workspace_download 寫入專案檔案並對外連線' }),
  // Ticket 06 expand slice: one invocation crosses the Outbound Data Gate
  // and writes only inside the frozen Restricted Project View.
  policyMigration: {
    capabilityApproval: 'workspace capability requires approval for outbound download',
    sideEffect: true,
    outbound: true,
    pathArguments: ['path'],
  },
  execute: async (args, ctx) => {
    const url = String(args.url || '').trim()
    const target = scopedTarget(ctx, args.path)
    if (!/^https?:\/\//i.test(url)) return structuredFailure('Only http(s) URLs are allowed')
    if (Array.isArray(target)) return structuredFailure(`path: ${target[1]}`)
    const maxBytes = Math.max(1, Math.min(50_000_000, Number(args.maxBytes) || 5_000_000))
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'SubAgentsAI/1.0' }, redirect: 'follow' })
      if (!response.ok) return structuredFailure(`download HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > maxBytes) return structuredFailure(`download exceeds maxBytes: ${buffer.byteLength} > ${maxBytes}`)
      await withFileMutationQueue(target, () => mkdir(dirname(target), { recursive: true }).then(() => writeFile(target, buffer)))
      return structuredOk(`已下載 ${buffer.byteLength} bytes 至 ${target}`, { bytes: buffer.byteLength, path: target })
    } catch (error) {
      return structuredFailure(error instanceof Error ? error.message : String(error))
    }
  },
}



export function buildWorkspaceExtraPack() {
  return {
    id: 'workspace-extra',
    name: 'Workspace Extras',
    description: 'Move, delete, diff, download — beyond Pi builtin write/edit',
    capability: 'workspace',
    tools: [workspaceDiff, workspaceMove, workspaceDelete, workspaceMkdir, workspaceDownload],
  }
}

let registered = false
export function ensureWorkspaceExtraPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildWorkspaceExtraPack())
}
