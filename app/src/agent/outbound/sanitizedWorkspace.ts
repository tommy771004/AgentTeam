/**
 * Provider-specific Sanitized Workspace (Restricted Project View) + safe writeback.
 * Pure Node/fs implementation for smoke + Electron main; browser → unavailable.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ProviderSecurityProfile } from './policyMerge.ts'
import { sanitizeTextWithProfile, type ProtectedExclusion } from './textSanitize.ts'

export type SanitizedViewCapability = {
  status: 'full' | 'unavailable'
  reason?: string
}

export function getSanitizedViewCapability(opts?: {
  hasNodeFs?: boolean
}): SanitizedViewCapability {
  const hasNodeFs = opts?.hasNodeFs ?? typeof fs?.mkdtempSync === 'function'
  if (!hasNodeFs) {
    return {
      status: 'unavailable',
      reason:
        'Sanitized Workspace requires Electron/Node filesystem; browser fallback does not claim isolation.',
    }
  }
  return { status: 'full' }
}

export type WorkspaceExclusion = ProtectedExclusion & { relPath: string }

export type SanitizedFileMapping = {
  relPath: string
  originalAbs: string
  sanitizedAbs: string
  /** Initial sanitized text for safe writeback (text files only). */
  initialSanitizedText?: string
}

export type SanitizedWorkspace = {
  connectionId: string
  originalRoot: string
  viewRoot: string
  exclusions: WorkspaceExclusion[]
  fileMappings: SanitizedFileMapping[]
  skipped: Array<{ relPath: string; reason: string }>
}

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.html',
  '.svg',
  '.env',
  '.sh',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.sql',
  '.xml',
  '.csv',
])

function isTextPath(rel: string): boolean {
  const ext = path.extname(rel).toLowerCase()
  if (TEXT_EXT.has(ext)) return true
  const base = path.basename(rel).toLowerCase()
  return base === 'dockerfile' || base === 'makefile' || base.startsWith('.env')
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === '.subagents') continue
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) stack.push(abs)
      else if (ent.isFile() || ent.isSymbolicLink()) out.push(abs)
    }
  }
  return out
}

function isInsideRoot(abs: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(abs))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Create a temporary provider-specific view of projectRoot.
 * Does not modify the original project.
 */
export async function createSanitizedWorkspace(opts: {
  connectionId: string
  projectRoot: string
  profile: ProviderSecurityProfile
  baseDir?: string
}): Promise<SanitizedWorkspace> {
  const cap = getSanitizedViewCapability()
  if (cap.status !== 'full') {
    throw new Error(cap.reason || 'Sanitized Workspace unavailable')
  }

  // realpath roots so macOS /var → /private/var does not false-positive "outside"
  const originalRoot = fs.realpathSync(path.resolve(opts.projectRoot))
  const parent = opts.baseDir || path.join(os.tmpdir(), 'subagents-sanitized')
  fs.mkdirSync(parent, { recursive: true })
  const safeConn = opts.connectionId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const viewRoot = fs.mkdtempSync(path.join(parent, `${safeConn}-`))

  const exclusions: WorkspaceExclusion[] = []
  const fileMappings: SanitizedWorkspace['fileMappings'] = []
  const skipped: SanitizedWorkspace['skipped'] = []

  const files = walkFiles(originalRoot)
  for (const abs of files) {
    const relPath = path.relative(originalRoot, abs)
    let real: string
    try {
      real = fs.realpathSync(abs)
    } catch {
      skipped.push({ relPath, reason: 'unreadable path' })
      continue
    }

    // Skip external symlink targets
    let isLink = false
    try {
      isLink = fs.lstatSync(abs).isSymbolicLink()
    } catch {
      /* ignore */
    }
    if (isLink && !isInsideRoot(real, originalRoot)) {
      skipped.push({ relPath, reason: 'external symlink target skipped' })
      continue
    }
    if (!isInsideRoot(real, originalRoot)) {
      skipped.push({ relPath, reason: 'path resolves outside project' })
      continue
    }

    const dest = path.join(viewRoot, relPath)
    fs.mkdirSync(path.dirname(dest), { recursive: true })

    if (!isTextPath(relPath)) {
      // PDF/Office → sanitized markdown sidecar; images/unknown stay unavailable
      try {
        const { buildSanitizedSidecar } = await import('./sanitizedSidecar.ts')
        const bytes = fs.readFileSync(abs)
        const side = buildSanitizedSidecar({
          relPath,
          bytes,
          profile: opts.profile,
        })
        if (side.ok) {
          const sideDest = dest + '.sidecar.md'
          fs.mkdirSync(path.dirname(sideDest), { recursive: true })
          fs.writeFileSync(sideDest, side.markdown, 'utf8')
          fileMappings.push({
            relPath: relPath + '.sidecar.md',
            originalAbs: abs,
            sanitizedAbs: sideDest,
          })
          // Do not copy original binary into the view
          skipped.push({
            relPath,
            reason: 'original binary withheld; sanitized sidecar available as .sidecar.md',
          })
          continue
        }
        skipped.push({ relPath, reason: side.reason })
      } catch (e) {
        skipped.push({
          relPath,
          reason: `non-text unavailable: ${e instanceof Error ? e.message : e}`,
        })
      }
      continue
    }

    let raw: string
    try {
      raw = fs.readFileSync(abs, 'utf8')
    } catch {
      skipped.push({ relPath, reason: 'read failed' })
      continue
    }

    const sanitized = sanitizeTextWithProfile(raw, opts.profile, { source: relPath })
    fs.writeFileSync(dest, sanitized.text, 'utf8')
    fileMappings.push({
      relPath,
      originalAbs: abs,
      sanitizedAbs: dest,
      initialSanitizedText: sanitized.text,
    })
    for (const e of sanitized.exclusions) {
      exclusions.push({ ...e, relPath, source: relPath })
    }
  }

  return {
    connectionId: opts.connectionId,
    originalRoot,
    viewRoot,
    exclusions,
    fileMappings,
    skipped,
  }
}

/**
 * Safe writeback from Restricted Project View to original (ADR-0008).
 * Only text mappings with initialSanitizedText; protected lines never overwrite originals.
 */
export function writebackSanitizedWorkspace(ws: SanitizedWorkspace): {
  filesWritten: number
  filesSkipped: number
  withheldRanges: number
} {
  let filesWritten = 0
  let filesSkipped = 0
  let withheldRanges = 0
  for (const m of ws.fileMappings) {
    if (m.initialSanitizedText == null) {
      filesSkipped++
      continue
    }
    if (!fs.existsSync(m.sanitizedAbs) || !fs.existsSync(m.originalAbs)) {
      filesSkipped++
      continue
    }
    try {
      const excl = ws.exclusions
        .filter((e) => e.relPath === m.relPath || e.source === m.relPath)
        .map((e) => ({ startLine: e.startLine, endLine: e.endLine }))
      const r = applySafeWritebackToOriginal({
        originalAbs: m.originalAbs,
        sanitizedAbs: m.sanitizedAbs,
        sanitizedBeforeText: m.initialSanitizedText,
        exclusions: excl,
      })
      if (r.wrote) filesWritten++
      else filesSkipped++
      withheldRanges += r.withheld.length
    } catch {
      filesSkipped++
    }
  }
  return { filesWritten, filesSkipped, withheldRanges }
}

export async function disposeSanitizedWorkspace(ws: SanitizedWorkspace): Promise<void> {
  try {
    fs.rmSync(ws.viewRoot, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
}

export type WritebackLineRange = { startLine: number; endLine: number }

export type SafeWritebackResult = {
  resultText: string
  applied: WritebackLineRange[]
  /** Metadata only — never original or replacement content */
  withheld: WritebackLineRange[]
}

function lineOverlapsExclusion(
  line: number,
  exclusions: WritebackLineRange[],
): boolean {
  return exclusions.some((e) => line >= e.startLine && line <= e.endLine)
}

/**
 * Reconstruct original project text after agent edits in the sanitized view.
 * - Lines that were protected keep the original project content.
 * - Safe lines take the sanitized-after content when the agent changed them.
 * - If the agent changes a protected line, that range is withheld.
 */
export function safeWritebackTextFile(opts: {
  originalText: string
  sanitizedBefore: string
  sanitizedAfter: string
  exclusions: WritebackLineRange[]
}): SafeWritebackResult {
  const origLines = opts.originalText.split('\n')
  const beforeLines = opts.sanitizedBefore.split('\n')
  const afterLines = opts.sanitizedAfter.split('\n')

  // Align on max length; missing lines treated as empty
  const n = Math.max(origLines.length, beforeLines.length, afterLines.length)
  const result: string[] = []
  const applied: WritebackLineRange[] = []
  const withheld: WritebackLineRange[] = []

  for (let i = 0; i < n; i++) {
    const lineNo = i + 1
    const orig = origLines[i] ?? ''
    const before = beforeLines[i] ?? ''
    const after = afterLines[i] ?? ''
    const protectedLine = lineOverlapsExclusion(lineNo, opts.exclusions)

    if (protectedLine) {
      if (after !== before) {
        withheld.push({ startLine: lineNo, endLine: lineNo })
      }
      result.push(orig)
      continue
    }

    if (after !== before) {
      applied.push({ startLine: lineNo, endLine: lineNo })
      result.push(after)
    } else {
      result.push(orig)
    }
  }

  // Coalesce adjacent applied/withheld ranges for cleaner metadata
  return {
    resultText: result.join('\n'),
    applied: coalesceRanges(applied),
    withheld: coalesceRanges(withheld),
  }
}

function coalesceRanges(ranges: WritebackLineRange[]): WritebackLineRange[] {
  if (!ranges.length) return []
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine)
  const out: WritebackLineRange[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, cur.endLine)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/** Apply writeback for one mapped text file on disk. */
export function applySafeWritebackToOriginal(opts: {
  originalAbs: string
  sanitizedAbs: string
  sanitizedBeforeText: string
  exclusions: WritebackLineRange[]
}): SafeWritebackResult & { wrote: boolean } {
  const originalText = fs.readFileSync(opts.originalAbs, 'utf8')
  const sanitizedAfter = fs.readFileSync(opts.sanitizedAbs, 'utf8')
  const r = safeWritebackTextFile({
    originalText,
    sanitizedBefore: opts.sanitizedBeforeText,
    sanitizedAfter,
    exclusions: opts.exclusions,
  })
  if (r.resultText !== originalText) {
    fs.writeFileSync(opts.originalAbs, r.resultText, 'utf8')
    return { ...r, wrote: true }
  }
  return { ...r, wrote: false }
}

/**
 * Single in-process registry of Restricted Project View roots by runId.
 * Production also pins here after main prepare succeeds; Node smokes pin via
 * bindSanitizedViewForRun / pinRestrictedViewRootForRun. Main's runViews map
 * remains the Electron filesystem owner — this is the tool-resolution pin.
 */
const _viewRootsByRun = new Map<string, string>()
/** Full workspace objects (smoke / writeback helpers); optional beside root pin. */
const _viewsByRun = new Map<string, SanitizedWorkspace>()

/** Pin only the view root (coordinator after prepare — no need for full ws). */
export function pinRestrictedViewRootForRun(runId: string, viewRoot: string): void {
  const id = String(runId || '').trim()
  const root = String(viewRoot || '').trim()
  if (!id || !root) return
  _viewRootsByRun.set(id, root)
}

export function unpinRestrictedViewRootForRun(runId: string): void {
  const id = String(runId || '').trim()
  if (!id) return
  _viewRootsByRun.delete(id)
  _viewsByRun.delete(id)
}

export function getRestrictedViewRootForRun(runId: string | undefined): string | undefined {
  if (!runId) return undefined
  return _viewRootsByRun.get(runId)
}

export function bindSanitizedViewForRun(runId: string, ws: SanitizedWorkspace): void {
  _viewsByRun.set(runId, ws)
  if (ws.viewRoot) pinRestrictedViewRootForRun(runId, ws.viewRoot)
}

export function unbindSanitizedViewForRun(runId: string): void {
  unpinRestrictedViewRootForRun(runId)
}

export function getSanitizedViewForRun(runId: string | undefined): SanitizedWorkspace | undefined {
  if (!runId) return undefined
  return _viewsByRun.get(runId)
}

/**
 * When a restricted view is bound, tools must use viewRoot instead of original project.
 * @deprecated Prefer resolveProtectedProjectRoot / resolveEffectiveProjectRoot.
 */
export function resolveRestrictedProjectRoot(opts: {
  explicitRoot?: string
  runId?: string
  protectionActive?: boolean
}): string | undefined {
  if (opts.protectionActive && opts.runId) {
    const pinned = getRestrictedViewRootForRun(opts.runId)
    if (pinned) return pinned
    const ws = getSanitizedViewForRun(opts.runId)
    if (ws) return ws.viewRoot
  }
  return opts.explicitRoot
}
