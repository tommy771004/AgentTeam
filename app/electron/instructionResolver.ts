import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { InstructionPresence } from './instructionRepository.ts'
import { LEGACY_DEFAULT_AGENTS, LEGACY_DEFAULT_SOUL } from '../src/agent/legacyInstructionDefaults.ts'
export { readProjectInstruction, recoverProjectInstruction, writeProjectInstruction } from './projectInstructionWriter.ts'
import { recoverProjectInstruction } from './projectInstructionWriter.ts'

export type InstructionSourceKind =
  | 'global-custom'
  | 'personality'
  | 'project-parent'
  | 'project-root'
  | 'project-directory'
  | 'project-override'
  | 'fallback'
  | 'include'

export type InstructionDiagnosticCode =
  | 'missing'
  | 'unreadable'
  | 'cycle'
  | 'unauthorized'
  | 'unsupported-target'
  | 'source-too-large'
  | 'depth-limit'
  | 'source-count-limit'
  | 'total-budget'
  | 'duplicate'

export type InstructionDiagnostic = Readonly<{
  code: InstructionDiagnosticCode
  message: string
  path?: string
  parentPath?: string
}>

export type InstructionSource = Readonly<{
  id: string
  kind: InstructionSourceKind
  scope: 'global' | 'project'
  path?: string
  parentPath?: string
  directoryDepth: number
  includeDepth: number
  revision: number
  bytes: number
  bytesKnown: boolean
  includedBytes: number
  droppedBytes: number
  hash: string
  applied: boolean
  deduplicated: boolean
  truncated: boolean
  shadowed: boolean
  /** Host-owned position in the effective source sequence; null means not applied. */
  effectiveOrder: number | null
  /** Metadata provenance for discovered sources, including non-applied ones. */
  metadataStatus: 'content' | 'metadata' | 'unavailable' | 'unauthorized'
  /** Only fresh, canonical, readable project files may be opened by Host. */
  openable: boolean
  content: string
}>

export type InstructionSnapshot = Readonly<{
  id: string
  revision: number
  projectIdentity?: string
  workPath?: string
  effectiveHash: string
  effectiveText: string
  /** Fully expanded global segment. Native CLI delivery must never rebuild it from provenance bodies. */
  globalEffectiveText: string
  /** Presence semantics survive migration even when the effective body is empty. */
  presence: Readonly<{
    globalCustomInstructions: InstructionPresence
    advancedPersonalityInstructions: InstructionPresence
  }>
  sources: readonly InstructionSource[]
  diagnostics: readonly InstructionDiagnostic[]
  usage: Readonly<{
    personalizationBytes: number
    personalizationBudgetBytes: number
    projectInstructionBytes: number
    projectInstructionBudgetBytes: number
    totalBytes: number
    budgetBytes: number
    /** Space lower-authority ContextPacket slots, beginning with learned memory, may still consume. */
    lowerAuthorityAvailableBytes: number
  }>
  deliveryMode: 'explicit'
  exactSnapshot: true
}>

export type ResolveInstructionInput = {
  globalRevision: number
  globalCustomInstructions: string
  advancedPersonalityInstructions?: string
  personality?: string
  aboutUser?: string
  responseStyle?: string
  globalCustomInstructionsPresence?: InstructionPresence
  advancedPersonalityInstructionsPresence?: InstructionPresence
  projectRoot?: string
  workPath?: string
  fallbackFilenames?: readonly string[]
  authorizedIncludeTargets?: readonly string[]
  limits?: Partial<{
    maxDepth: number
    maxSources: number
    perFileBytes: number
    totalBytes: number
    personalizationBytes: number
    projectInstructionBytes: number
  }>
}

export const DEFAULT_INSTRUCTION_CONTEXT_LIMITS = Object.freeze({
  maxDepth: 5,
  maxSources: 32,
  perFileBytes: 64 * 1024,
  totalBytes: 192 * 1024,
  // Separate auditable ContextPacket-style slots. The common total remains
  // the final authority, so unused capacity in one slot is not silently
  // reassigned to the other.
  personalizationBytes: 64 * 1024,
  projectInstructionBytes: 128 * 1024,
})
const DEFAULT_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const
const PERSONALITY_TEXT: Readonly<Record<string, string>> = {
  default: '',
  none: '不要套用特定人格；以中性、直接、專業的口吻回覆。',
  friendly: '語氣友善、鼓勵、易懂；適度使用溫暖表達，但避免過度口語。',
  efficient: '務實精簡：先給結論與可執行步驟，少寒暄，條列優先。',
  professional: '正式專業：結構清楚、用詞精準，適合職場與文件。',
  candid: '直率坦誠：指出風險與取捨，不迴避壞消息，但仍保持尊重。',
  quirky: '可以略帶幽默與創意，但不犧牲正確性與可執行性。',
}

function hash(text: string): string { return createHash('sha256').update(text).digest('hex') }
function metadataHash(path: string, statInfo: { size: number; mtimeMs: number }, status: string): string {
  return hash(`${status}:${path}:${statInfo.size}:${statInfo.mtimeMs}`)
}
function presenceOf(value: string | undefined, explicit?: InstructionPresence): InstructionPresence {
  if (explicit) return explicit
  if (value === undefined) return 'unset'
  return value.trim() ? 'value' : 'blank'
}
function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
function isFallbackControl(character: string): boolean {
  const codePoint = character.codePointAt(0) || 0
  // Unicode Cc covers the C0 and C1 control ranges. Keep DEL and the two
  // Unicode line separators explicit as they are not contiguous with C0/C1
  // in a way that is obvious at the call site.
  return (codePoint <= 0x1f)
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || codePoint === 0x2028
    || codePoint === 0x2029
}
function safeFallbackNames(values: readonly string[] | undefined): string[] {
  const unique = new Set<string>()
  const reserved = new Set([...DEFAULT_NAMES, 'AGENTS.override.md'].map((name) => name.normalize('NFC').toLowerCase()))
  for (const value of values || []) {
    const normalized = value.trim().normalize('NFC')
    // Fallback configuration is a compatibility allowlist, not a path
    // resolver. Normalize first so NFC/NFD spellings have one stable identity,
    // then apply the portable basename policy. Unicode letters are valid; path
    // separators, controls, globs, Windows-reserved punctuation and traversal
    // are not. `toLowerCase()` is locale-independent and catches collisions
    // that are distinct only on a case-sensitive filesystem.
    const key = normalized.toLowerCase()
    const hasControl = [...normalized].some(isFallbackControl)
    const hasPortablePathPunctuation = ['\\', '/', '*', '?', '[', ']', '<', '>', ':', '"', '|'].some((character) => normalized.includes(character))
    if (!normalized || normalized !== basename(normalized) || normalized === '.' || normalized === '..'
      || normalized.length > 128 || hasControl
      || hasPortablePathPunctuation
      || reserved.has(key) || unique.has(key)) continue
    unique.add(key)
    // Preserve first-seen stable order while retaining the normalized spelling.
    // The result pass below emits the normalized value in input order.
    if (unique.size >= 8) break
  }
  // The set stores collision keys. Rebuild in the same input order so callers
  // receive normalized names rather than implementation details of the key set.
  const result: string[] = []
  const emitted = new Set<string>()
  for (const value of values || []) {
    const normalized = value.trim().normalize('NFC')
    const key = normalized.toLowerCase()
    if (unique.has(key) && !emitted.has(key)) {
      result.push(normalized)
      emitted.add(key)
    }
    if (result.length >= 8) break
  }
  return result
}
function utf8Slice(text: string, bytes: number): string {
  const input = Buffer.from(text)
  if (input.byteLength <= bytes) return text
  let end = Math.max(0, bytes)
  while (end > 0 && (input[end] & 0xc0) === 0x80) end -= 1
  return input.subarray(0, end).toString('utf8')
}

async function canonicalExisting(path: string): Promise<string> {
  return realpath(path)
}

/**
 * Find the nearest canonical repository boundary without crossing a .git
 * marker. A project selected below a worktree may inherit parent guidance up
 * to that boundary; a repository root itself has no parent layers.
 */
async function gitBoundary(start: string): Promise<string | undefined> {
  let cursor = start
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const marker = await stat(join(cursor, '.git'))
      if (marker.isDirectory() || marker.isFile()) return cursor
    } catch { /* not a repository marker */ }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return undefined
}

async function chosenInstruction(directory: string, fallbacks: readonly string[]): Promise<{ path: string; kind: InstructionSourceKind; shadowed: string[] } | null> {
  const candidates: Array<{ name: string; kind: InstructionSourceKind }> = [
    { name: 'AGENTS.override.md', kind: 'project-override' },
    { name: 'AGENTS.md', kind: 'project-directory' },
    { name: 'CLAUDE.md', kind: 'project-directory' },
    ...fallbacks.map((name) => ({ name, kind: 'fallback' as const })),
  ]
  const existing: typeof candidates = []
  for (const candidate of candidates) {
    try { const info = await stat(join(directory, candidate.name)); if (info.isFile()) existing.push(candidate) } catch { /* optional */ }
  }
  if (!existing.length) return null
  return { path: join(directory, existing[0].name), kind: existing[0].kind, shadowed: existing.slice(1).map((item) => join(directory, item.name)) }
}

export async function resolveInstructionSnapshot(input: ResolveInstructionInput): Promise<InstructionSnapshot> {
  const limits = { ...DEFAULT_INSTRUCTION_CONTEXT_LIMITS, ...input.limits }
  const diagnostics: InstructionDiagnostic[] = []
  const sources: InstructionSource[] = []
  const seenContent = new Set<string>()
  const activePaths = new Set<string>()
  let remaining = limits.totalBytes
  const slotRemaining: Record<'global' | 'project', number> = {
    global: Math.min(limits.personalizationBytes, limits.totalBytes),
    project: Math.min(limits.projectInstructionBytes, limits.totalBytes),
  }
  let projectRoot = ''
  // Discovery may walk up to discoveryBoundary for parent layers, while
  // project-authored includes use this stricter canonical project boundary.
  let includeBoundary = ''
  let discoveryBoundary = ''
  let workPath = ''
  const authorized = new Set<string>()
  for (const target of input.authorizedIncludeTargets || []) {
    // The repository stores the canonical identity observed at authorization
    // time. Do not realpath it again here: a symlink retarget must produce a
    // different resolved identity and require a fresh explicit grant.
    if (isAbsolute(target)) authorized.add(resolve(target))
  }

  if (input.projectRoot?.trim()) {
    try {
      projectRoot = await canonicalExisting(input.projectRoot)
      includeBoundary = projectRoot
      discoveryBoundary = await gitBoundary(projectRoot) || projectRoot
      const requestedWork = input.workPath?.trim() || projectRoot
      workPath = await canonicalExisting(requestedWork)
      if (!within(projectRoot, workPath)) {
        diagnostics.push({ code: 'unauthorized', path: workPath, message: 'workPath 不在 canonical project boundary 內。' })
        workPath = projectRoot
      }
    } catch (error) {
      diagnostics.push({ code: 'unreadable', path: input.projectRoot, message: error instanceof Error ? error.message : 'project 無法解析。' })
      projectRoot = ''
      workPath = ''
    }
  }

  // Recovery is part of Host resolution, before any source body or metadata
  // can reach the projection/model. A malformed or degraded journal throws a
  // typed integrity failure instead of being treated as an absent source.
  if (projectRoot) {
    for (const target of ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md']) {
      await recoverProjectInstruction(projectRoot, target)
    }
  }

  const addText = (kind: InstructionSourceKind, scope: 'global' | 'project', content: string, path?: string, parentPath?: string, directoryDepth = 0, shadowed = false, includeDepth = 0) => {
    if (sources.length >= limits.maxSources) {
      diagnostics.push({ code: 'source-count-limit', path, parentPath, message: 'instruction source count 超過上限。' })
      return { content: '', applied: false }
    }
    const requestedBytes = Buffer.byteLength(content)
    const perFile = Math.min(limits.perFileBytes, remaining, slotRemaining[scope])
    const clipped = utf8Slice(content, perFile)
    const contentHash = hash(content)
    // Deduplicate only the complete normalized source body. Hashing the
    // clipped prefix would incorrectly collapse two files that merely share
    // the same first `perFileBytes` bytes while differing afterwards.
    const normalizedHash = hash(content.trim())
    const duplicate = clipped.trim().length > 0 && seenContent.has(normalizedHash)
    const overPerFile = requestedBytes > limits.perFileBytes
    const overTotal = requestedBytes > remaining
    const overSlot = requestedBytes > slotRemaining[scope]
    // A clipped or budget-exceeding source is provenance only. Never report
    // its prefix as delivered bytes, otherwise usage and Turn Record fidelity
    // imply model-visible text that was deliberately rejected.
    const includedBytes = duplicate || overPerFile || overTotal || overSlot ? 0 : Buffer.byteLength(clipped)
    const applied = !shadowed && !overPerFile && !overTotal && !overSlot && clipped.trim().length > 0 && includedBytes > 0
    if (requestedBytes > limits.perFileBytes) diagnostics.push({ code: 'source-too-large', path, parentPath, message: `source 超過 ${limits.perFileBytes} bytes，已裁切。` })
    if (requestedBytes > remaining) diagnostics.push({ code: 'total-budget', path, parentPath, message: 'instruction total budget 已用盡或裁切。' })
    if (requestedBytes > slotRemaining[scope]) diagnostics.push({
      code: 'total-budget',
      path,
      parentPath,
      message: `${scope === 'global' ? 'global personalization' : 'project instructions'} sub-budget 已用盡或裁切。`,
    })
    if (duplicate) diagnostics.push({ code: 'duplicate', path, parentPath, message: '內容與較早 source 完全重複，保留 provenance 但不重複注入。' })
    if (applied) {
      seenContent.add(normalizedHash)
      remaining -= includedBytes
      slotRemaining[scope] -= includedBytes
    }
    sources.push(Object.freeze({ id: hash(`${kind}:${path || 'db'}:${parentPath || ''}:${includeDepth}:${contentHash}`), kind, scope, ...(path ? { path } : {}), ...(parentPath ? { parentPath } : {}), directoryDepth, includeDepth, revision: input.globalRevision, bytes: requestedBytes, bytesKnown: true, includedBytes, droppedBytes: Math.max(0, requestedBytes - includedBytes), hash: contentHash, applied, deduplicated: duplicate, truncated: clipped !== content, shadowed, effectiveOrder: null, metadataStatus: 'content' as const, openable: Boolean(path && scope === 'project' && (!projectRoot || within(projectRoot, path))), content: applied ? clipped : '' }))
    return { content: clipped, applied, traverse: !overPerFile && !overTotal && !overSlot && clipped.trim().length > 0 }
  }

  const addDiscoveredMetadata = async (requested: string, kind: InstructionSourceKind, parentPath: string | undefined, directoryDepth: number, failureCode?: 'missing' | 'unreadable' | 'unauthorized', shadowed = true, includeDepth = 0, scope: 'global' | 'project' = 'project') => {
    if (sources.length >= limits.maxSources) {
      diagnostics.push({ code: 'source-count-limit', path: requested, parentPath, message: 'instruction source count 超過上限。' })
      return
    }
    let canonical = requested
    try { canonical = await canonicalExisting(requested) } catch (error) {
      diagnostics.push({ code: failureCode || 'missing', path: requested, parentPath, message: error instanceof Error ? error.message : 'source 不存在。' })
      const unavailableHash = hash(`unavailable:${requested}`)
      sources.push(Object.freeze({ id: hash(`${kind}:${requested}:${parentPath || ''}:${includeDepth}:${unavailableHash}`), kind, scope, path: requested, ...(parentPath ? { parentPath } : {}), directoryDepth, includeDepth, revision: input.globalRevision, bytes: -1, bytesKnown: false, includedBytes: 0, droppedBytes: 0, hash: unavailableHash, applied: false, deduplicated: false, truncated: false, shadowed, effectiveOrder: null, metadataStatus: 'unavailable' as const, openable: false, content: '' }))
      return
    }
    // Parent-layer metadata may legitimately sit above the selected project
    // root (but still inside the Git discovery boundary). Include targets are
    // different: a project include must stay inside projectRoot unless its
    // canonical identity was explicitly authorized.
    const unauthorizedProjectInclude = scope === 'project'
      && kind === 'include'
      && Boolean(includeBoundary)
      && !within(includeBoundary, canonical)
      && !authorized.has(canonical)
    if (unauthorizedProjectInclude || (discoveryBoundary && !within(discoveryBoundary, canonical))) {
      let statInfo: { size: number; mtimeMs: number } | undefined
      try { const info = await stat(canonical); statInfo = { size: info.size, mtimeMs: info.mtimeMs } } catch { /* metadata may be unavailable outside the boundary */ }
      const escapedHash = statInfo ? metadataHash(canonical, statInfo, 'unauthorized') : hash(`unauthorized:${canonical}`)
      diagnostics.push({ code: 'unauthorized', path: canonical, parentPath, message: 'source 逃離 canonical project boundary，未加入 effective text。' })
      sources.push(Object.freeze({ id: hash(`${kind}:${canonical}:${parentPath || ''}:${includeDepth}:${escapedHash}`), kind, scope, path: canonical, ...(parentPath ? { parentPath } : {}), directoryDepth, includeDepth, revision: input.globalRevision, bytes: statInfo?.size ?? -1, bytesKnown: Boolean(statInfo), includedBytes: 0, droppedBytes: 0, hash: escapedHash, applied: false, deduplicated: false, truncated: false, shadowed, effectiveOrder: null, metadataStatus: statInfo ? 'unauthorized' as const : 'unavailable' as const, openable: false, content: '' }))
      return
    }
    try {
      await access(canonical, constants.R_OK)
      const raw = await readFile(canonical, 'utf8')
      const contentHash = hash(raw)
      const bytes = Buffer.byteLength(raw)
      sources.push(Object.freeze({ id: hash(`${kind}:${canonical}:${parentPath || ''}:${includeDepth}:${contentHash}`), kind, scope, path: canonical, ...(parentPath ? { parentPath } : {}), directoryDepth, includeDepth, revision: input.globalRevision, bytes, bytesKnown: true, includedBytes: 0, droppedBytes: bytes, hash: contentHash, applied: false, deduplicated: false, truncated: false, shadowed, effectiveOrder: null, metadataStatus: 'content' as const, openable: Boolean(scope === 'project' && projectRoot && within(projectRoot, canonical)), content: '' }))
    } catch (error) {
      let statInfo: { size: number; mtimeMs: number } | undefined
      try { const info = await stat(canonical); statInfo = { size: info.size, mtimeMs: info.mtimeMs } } catch { /* unavailable */ }
      const unreadableHash = statInfo ? metadataHash(canonical, statInfo, 'unreadable') : hash(`unreadable:${canonical}`)
      diagnostics.push({ code: 'unreadable', path: canonical, parentPath, message: error instanceof Error ? error.message : 'source 無法讀取。' })
      sources.push(Object.freeze({ id: hash(`${kind}:${canonical}:${parentPath || ''}:${includeDepth}:${unreadableHash}`), kind, scope, path: canonical, ...(parentPath ? { parentPath } : {}), directoryDepth, includeDepth, revision: input.globalRevision, bytes: statInfo?.size ?? -1, bytesKnown: Boolean(statInfo), includedBytes: 0, droppedBytes: 0, hash: unreadableHash, applied: false, deduplicated: false, truncated: false, shadowed, effectiveOrder: null, metadataStatus: statInfo ? 'metadata' as const : 'unavailable' as const, openable: false, content: '' }))
    }
  }

  const expandFile = async (requested: string, ownerScope: 'global' | 'project', kind: InstructionSourceKind, parentPath?: string, depth = 0, directoryDepth = 0): Promise<string> => {
    if (depth > limits.maxDepth) {
      diagnostics.push({ code: 'depth-limit', path: requested, parentPath, message: 'include depth 超過上限。' })
      await addDiscoveredMetadata(requested, 'include', parentPath, directoryDepth, undefined, false, depth, ownerScope)
      return ''
    }
    if (sources.length >= limits.maxSources) { diagnostics.push({ code: 'source-count-limit', path: requested, parentPath, message: 'instruction source count 超過上限。' }); return '' }
    let canonical = ''
    try { canonical = await canonicalExisting(requested) } catch {
      await addDiscoveredMetadata(requested, 'include', parentPath, directoryDepth, 'missing', false, depth, ownerScope)
      return ''
    }
    if (ownerScope === 'project' && kind === 'include' && includeBoundary && !within(includeBoundary, canonical) && !authorized.has(canonical)) {
      await addDiscoveredMetadata(canonical, 'include', parentPath, directoryDepth, 'unauthorized', false, depth, ownerScope)
      return ''
    }
    if (activePaths.has(canonical)) {
      diagnostics.push({ code: 'cycle', path: canonical, parentPath, message: '偵測到 include cycle。' })
      await addDiscoveredMetadata(canonical, 'include', parentPath, directoryDepth, undefined, false, depth, ownerScope)
      return ''
    }
    activePaths.add(canonical)
    try {
      await access(canonical, constants.R_OK)
      const raw = await readFile(canonical, 'utf8')
      const own = addText(kind, ownerScope, raw, canonical, parentPath, directoryDepth, false, depth)
      if (!own.traverse) return ''
      const expanded: string[] = []
      for (const line of own.content.split('\n')) {
        const match = line.match(/^\s*@([^\s].*?)\s*$/)
        // Identical include directives can resolve differently from different
        // parent directories. Always parse them for cycle/auth diagnostics,
        // while omitting duplicate ordinary text from the model-visible body.
        if (!match) { if (own.applied) expanded.push(line); continue }
        const targetText = match[1].trim()
        if (/^[a-z]+:\/\//i.test(targetText)) {
          diagnostics.push({ code: 'unsupported-target', path: targetText, parentPath: canonical, message: '只支援本機檔案 include。' }); continue
        }
        const target = isAbsolute(targetText) ? targetText : resolve(dirname(canonical), targetText)
        expanded.push(await expandFile(target, ownerScope, 'include', canonical, depth + 1, directoryDepth))
      }
      return expanded.join('\n')
    } catch {
      // Keep a discovered source in the projection even when its body became
      // unreadable after canonicalization. Metadata is collected separately;
      // no degraded body can enter effectiveText.
      await addDiscoveredMetadata(requested, kind, parentPath, directoryDepth, 'unreadable', false, depth, ownerScope)
      return ''
    } finally { activePaths.delete(canonical) }
  }

  const projectBlocks: Array<{ scope: 'project'; text: string; order: number }> = []
  const globalBlocks: Array<{ scope: 'global'; text: string }> = []
  const globalPresence = presenceOf(input.globalCustomInstructions, input.globalCustomInstructionsPresence)
  const advancedPresence = presenceOf(input.advancedPersonalityInstructions, input.advancedPersonalityInstructionsPresence)
  const reserveHeading = (scope: 'global' | 'project', heading: string, path?: string): boolean => {
    // Delimiters are charged only when an already assembled block will make
    // the new block non-leading. The previous fixed project reservation made
    // a sole project block fail at its exact budget edge.
    const separatorBytes = globalBlocks.length + projectBlocks.length > 0 ? 2 : 0
    const bytes = Buffer.byteLength(`${heading}\n`) + separatorBytes
    if (bytes > remaining || bytes > slotRemaining[scope]) {
      diagnostics.push({
        code: 'total-budget',
        path,
        message: bytes > remaining
          ? 'instruction total budget 無法容納 source heading。'
          : `${scope === 'global' ? 'global personalization' : 'project instructions'} sub-budget 無法容納 source heading。`,
      })
      return false
    }
    remaining -= bytes
    slotRemaining[scope] -= bytes
    return true
  }

  if (projectRoot) {
    const workDirs: string[] = []
    let cursor = workPath
    while (within(projectRoot, cursor)) {
      workDirs.unshift(cursor)
      if (cursor === projectRoot) break
      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
    const parentDirs: string[] = []
    if (discoveryBoundary !== projectRoot && within(discoveryBoundary, projectRoot)) {
      let parent = dirname(projectRoot)
      while (within(discoveryBoundary, parent)) {
        parentDirs.unshift(parent)
        if (parent === discoveryBoundary) break
        const next = dirname(parent)
        if (next === parent) break
        parent = next
      }
    }
    const layers = [
      ...parentDirs.map((directory, index) => ({ directory, directoryDepth: index - parentDirs.length, parent: true })),
      ...workDirs.map((directory, index) => ({ directory, directoryDepth: index, parent: false })),
    ]
    const fallbacks = safeFallbackNames(input.fallbackFilenames)
    // Discover nearest/highest-authority layers first so finite budgets and
    // source caps preserve the specific instruction that must win. Effective
    // assembly is restored to broad-to-narrow order by `projectBlocks.order`
    // and the final source projection sort below.
    for (const layer of [...layers].reverse()) {
      if (sources.length >= limits.maxSources) {
        diagnostics.push({ code: 'source-count-limit', path: layer.directory, message: 'instruction source count 超過上限，停止後續 discovery。' })
        break
      }
      const chosen = await chosenInstruction(layer.directory, fallbacks)
      if (!chosen) continue
      const kind = chosen.kind === 'project-directory'
        ? layer.parent ? 'project-parent' : layer.directory === projectRoot ? 'project-root' : 'project-directory'
        : chosen.kind
      const heading = `## 專案指令：${chosen.path}`
      if (!reserveHeading('project', heading, chosen.path)) break
      const expanded = await expandFile(chosen.path, 'project', kind, undefined, 0, layer.directoryDepth)
      if (expanded.trim()) projectBlocks.push({ scope: 'project', text: `${heading}\n${expanded}`, order: layer.directoryDepth })
      for (const path of chosen.shadowed) {
        const name = basename(path)
        const shadowKind: InstructionSourceKind = name === 'AGENTS.override.md'
          ? 'project-override'
          : name === 'AGENTS.md' || name === 'CLAUDE.md'
            ? layer.parent ? 'project-parent' : layer.directory === projectRoot ? 'project-root' : 'project-directory'
            : 'fallback'
        await addDiscoveredMetadata(path, shadowKind, undefined, layer.directoryDepth)
      }
    }
  }

  // Allocate the finite budget to higher-authority project sources first,
  // while preserving the model assembly order global-to-specific.
  const globalContent = input.globalCustomInstructions.trim()
    ? input.globalCustomInstructions
    : globalPresence === 'blank' ? LEGACY_DEFAULT_AGENTS : ''
  if (globalContent.trim() && reserveHeading('global', '## 全域自訂指令')) {
    const globalRaw = addText('global-custom', 'global', globalContent)
    const expanded: string[] = []
    if (globalRaw.traverse) {
      for (const line of globalRaw.content.split('\n')) {
        const match = line.match(/^\s*@([^\s].*?)\s*$/)
        if (!match) { if (globalRaw.applied) expanded.push(line); continue }
        const targetText = match[1].trim()
        if (!isAbsolute(targetText)) { diagnostics.push({ code: 'unsupported-target', path: targetText, message: 'global include 必須是 absolute local path。' }); continue }
        expanded.push(await expandFile(targetText, 'global', 'include', undefined, 1))
      }
    }
    const text = expanded.join('\n')
    if (text.trim()) globalBlocks.push({ scope: 'global', text: `## 全域自訂指令\n${text}` })
  }
  const addGlobalBlock = (heading: string, content: string | undefined, presence?: InstructionPresence, blankFallback?: string) => {
    const effectiveContent = content?.trim() ? content : presence === 'blank' ? blankFallback : undefined
    if (!effectiveContent?.trim() || !reserveHeading('global', heading)) return
    const added = addText('personality', 'global', effectiveContent)
    if (added.applied && added.content.trim()) globalBlocks.push({ scope: 'global', text: `${heading}\n${added.content}` })
  }
  addGlobalBlock('## 進階人格指令', input.advancedPersonalityInstructions, advancedPresence, LEGACY_DEFAULT_SOUL)
  addGlobalBlock('## 人格', input.personality ? (PERSONALITY_TEXT[input.personality] ?? input.personality) : undefined)
  addGlobalBlock('## 關於使用者', input.aboutUser)
  addGlobalBlock('## 回覆偏好', input.responseStyle)

  projectBlocks.sort((left, right) => left.order - right.order)
  const blocks = [...globalBlocks, ...projectBlocks]
  const effectiveText = blocks.map((block) => block.text).join('\n\n').trim()
  const globalText = globalBlocks.map((block) => block.text).join('\n\n').trim()
  const projectText = projectBlocks.map((block) => block.text).join('\n\n').trim()
  const personalizationBytes = Buffer.byteLength(globalText)
  const projectInstructionBytes = Buffer.byteLength(projectText) + (globalText && projectText ? 2 : 0)
  const effectiveBytes = Buffer.byteLength(effectiveText)
  const orderedSourcesBase = [...sources].sort((left, right) =>
    Number(left.scope === 'project') - Number(right.scope === 'project')
      || left.directoryDepth - right.directoryDepth,
  )
  // This is a Host fact, not a renderer-derived row number. Keep the source
  // projection's deterministic order and explicitly mark every non-applied
  // provenance row as null so shadowed/degraded entries cannot masquerade as
  // part of effective delivery.
  const effectiveOrderById = new Map<string, number>()
  for (const source of orderedSourcesBase) {
    if (source.applied) effectiveOrderById.set(source.id, effectiveOrderById.size + 1)
  }
  const orderedSources = orderedSourcesBase.map((source) => Object.freeze({
    ...source,
    effectiveOrder: source.applied ? effectiveOrderById.get(source.id) ?? null : null,
  }))
  const presence = Object.freeze({
    globalCustomInstructions: globalPresence,
    advancedPersonalityInstructions: advancedPresence,
  })
  const identity = hash(JSON.stringify({ revision: input.globalRevision, projectRoot, workPath, presence, sources: orderedSources.map((source) => [source.id, source.hash, source.applied]) }))
  return Object.freeze({
    id: `ins_${identity.slice(0, 20)}`,
    revision: input.globalRevision,
    ...(projectRoot ? { projectIdentity: projectRoot, workPath } : {}),
    effectiveHash: hash(effectiveText),
    effectiveText,
    globalEffectiveText: globalText,
    presence,
    sources: Object.freeze(orderedSources),
    diagnostics: Object.freeze(diagnostics),
    usage: Object.freeze({
      personalizationBytes,
      personalizationBudgetBytes: Math.min(limits.personalizationBytes, limits.totalBytes),
      projectInstructionBytes,
      projectInstructionBudgetBytes: Math.min(limits.projectInstructionBytes, limits.totalBytes),
      totalBytes: effectiveBytes,
      budgetBytes: limits.totalBytes,
      lowerAuthorityAvailableBytes: Math.max(0, limits.totalBytes - effectiveBytes),
    }),
    deliveryMode: 'explicit',
    exactSnapshot: true,
  })
}
