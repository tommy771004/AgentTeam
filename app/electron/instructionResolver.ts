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

type ResolverLimits = {
  maxDepth: number
  maxSources: number
  perFileBytes: number
  totalBytes: number
  personalizationBytes: number
  projectInstructionBytes: number
}

type ResolverContext = {
  input: ResolveInstructionInput
  limits: ResolverLimits
  diagnostics: InstructionDiagnostic[]
  sources: InstructionSource[]
  seenContent: Set<string>
  activePaths: Set<string>
  authorized: Set<string>
  slotRemaining: Record<'global' | 'project', number>
  remaining: number
  projectRoot: string
  includeBoundary: string
  discoveryBoundary: string
  workPath: string
}

type SourceBlock = { scope: 'global' | 'project'; text: string; order?: number }
type SourceRequest = {
  kind: InstructionSourceKind
  scope: 'global' | 'project'
  content: string
  path?: string
  parentPath?: string
  directoryDepth?: number
  shadowed?: boolean
  includeDepth?: number
}
type MetadataRequest = {
  requested: string
  kind: InstructionSourceKind
  parentPath?: string
  directoryDepth: number
  failureCode?: 'missing' | 'unreadable' | 'unauthorized'
  shadowed: boolean
  includeDepth: number
  scope: 'global' | 'project'
}
type ProjectLayer = { directory: string; directoryDepth: number; parent: boolean }

function makeResolverLimits(input: ResolveInstructionInput): ResolverLimits {
  return { ...DEFAULT_INSTRUCTION_CONTEXT_LIMITS, ...input.limits }
}

function makeAuthorizedTargets(input: ResolveInstructionInput): Set<string> {
  const authorized = new Set<string>()
  for (const target of input.authorizedIncludeTargets || []) {
    // Authorization stores the observed canonical identity. A later resolve
    // must not realpath the saved path again and accidentally grant a retarget.
    if (isAbsolute(target)) authorized.add(resolve(target))
  }
  return authorized
}

async function initializeProjectContext(context: ResolverContext): Promise<void> {
  const requestedRoot = context.input.projectRoot
  if (!requestedRoot?.trim()) return
  try {
    context.projectRoot = await canonicalExisting(requestedRoot)
    context.includeBoundary = context.projectRoot
    context.discoveryBoundary = await gitBoundary(context.projectRoot) || context.projectRoot
    const requestedWork = context.input.workPath?.trim() || context.projectRoot
    context.workPath = await canonicalExisting(requestedWork)
    if (!within(context.projectRoot, context.workPath)) {
      context.diagnostics.push({ code: 'unauthorized', path: context.workPath, message: 'workPath 不在 canonical project boundary 內。' })
      context.workPath = context.projectRoot
    }
  } catch (error) {
    context.diagnostics.push({ code: 'unreadable', path: requestedRoot, message: error instanceof Error ? error.message : 'project 無法解析。' })
    context.projectRoot = ''
    context.workPath = ''
  }
}

async function makeResolverContext(input: ResolveInstructionInput): Promise<ResolverContext> {
  const limits = makeResolverLimits(input)
  const context: ResolverContext = {
    input,
    limits,
    diagnostics: [],
    sources: [],
    seenContent: new Set<string>(),
    activePaths: new Set<string>(),
    authorized: makeAuthorizedTargets(input),
    slotRemaining: {
      global: Math.min(limits.personalizationBytes, limits.totalBytes),
      project: Math.min(limits.projectInstructionBytes, limits.totalBytes),
    },
    remaining: limits.totalBytes,
    projectRoot: '',
    includeBoundary: '',
    discoveryBoundary: '',
    workPath: '',
  }
  await initializeProjectContext(context)
  return context
}

async function recoverInstructionSources(context: ResolverContext): Promise<void> {
  if (!context.projectRoot) return
  for (const target of ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md']) {
    await recoverProjectInstruction(context.projectRoot, target)
  }
}

type TextAdmission = {
  requestedBytes: number
  clipped: string
  contentHash: string
  duplicate: boolean
  overPerFile: boolean
  overTotal: boolean
  overSlot: boolean
  includedBytes: number
  applied: boolean
}

function calculateTextAdmission(context: ResolverContext, request: SourceRequest): TextAdmission {
  const requestedBytes = Buffer.byteLength(request.content)
  const perFile = Math.min(context.limits.perFileBytes, context.remaining, context.slotRemaining[request.scope])
  const clipped = utf8Slice(request.content, perFile)
  const contentHash = hash(request.content)
  const normalizedHash = hash(request.content.trim())
  const duplicate = clipped.trim().length > 0 && context.seenContent.has(normalizedHash)
  const overPerFile = requestedBytes > context.limits.perFileBytes
  const overTotal = requestedBytes > context.remaining
  const overSlot = requestedBytes > context.slotRemaining[request.scope]
  const includedBytes = duplicate || overPerFile || overTotal || overSlot ? 0 : Buffer.byteLength(clipped)
  const applied = !request.shadowed && !overPerFile && !overTotal && !overSlot && clipped.trim().length > 0 && includedBytes > 0
  return { requestedBytes, clipped, contentHash, duplicate, overPerFile, overTotal, overSlot, includedBytes, applied }
}

function commitTextAdmission(context: ResolverContext, request: SourceRequest, admission: TextAdmission): void {
  if (!admission.applied) return
  context.seenContent.add(hash(request.content.trim()))
  context.remaining -= admission.includedBytes
  context.slotRemaining[request.scope] -= admission.includedBytes
}

function appendTextSource(context: ResolverContext, request: SourceRequest, admission: TextAdmission): void {
  const path = request.path
  const parentPath = request.parentPath
  const directoryDepth = request.directoryDepth ?? 0
  const includeDepth = request.includeDepth ?? 0
  const shadowed = request.shadowed ?? false
  context.sources.push(Object.freeze({
    id: hash(`${request.kind}:${path || 'db'}:${parentPath || ''}:${includeDepth}:${admission.contentHash}`),
    kind: request.kind,
    scope: request.scope,
    ...(path ? { path } : {}),
    ...(parentPath ? { parentPath } : {}),
    directoryDepth,
    includeDepth,
    revision: context.input.globalRevision,
    bytes: admission.requestedBytes,
    bytesKnown: true,
    includedBytes: admission.includedBytes,
    droppedBytes: Math.max(0, admission.requestedBytes - admission.includedBytes),
    hash: admission.contentHash,
    applied: admission.applied,
    deduplicated: admission.duplicate,
    truncated: admission.clipped !== request.content,
    shadowed,
    effectiveOrder: null,
    metadataStatus: 'content' as const,
    openable: Boolean(path && request.scope === 'project' && (!context.projectRoot || within(context.projectRoot, path))),
    content: admission.applied ? admission.clipped : '',
  }))
}

function addText(context: ResolverContext, request: SourceRequest): { content: string; applied: boolean; traverse: boolean } {
  if (context.sources.length >= context.limits.maxSources) {
    context.diagnostics.push({ code: 'source-count-limit', path: request.path, parentPath: request.parentPath, message: 'instruction source count 超過上限。' })
    return { content: '', applied: false, traverse: false }
  }
  const admission = calculateTextAdmission(context, request)
  addTextDiagnostics(context, request, admission)
  commitTextAdmission(context, request, admission)
  appendTextSource(context, request, admission)
  return { content: admission.clipped, applied: admission.applied, traverse: !admission.overPerFile && !admission.overTotal && !admission.overSlot && admission.clipped.trim().length > 0 }
}

function addTextDiagnostics(context: ResolverContext, request: SourceRequest, admission: TextAdmission): void {
  const { overPerFile, overTotal, overSlot, duplicate } = admission
  const path = request.path
  const parentPath = request.parentPath
  if (overPerFile) context.diagnostics.push({ code: 'source-too-large', path, parentPath, message: `source 超過 ${context.limits.perFileBytes} bytes，已裁切。` })
  if (overTotal) context.diagnostics.push({ code: 'total-budget', path, parentPath, message: 'instruction total budget 已用盡或裁切。' })
  if (overSlot) context.diagnostics.push({
    code: 'total-budget',
    path,
    parentPath,
    message: `${request.scope === 'global' ? 'global personalization' : 'project instructions'} sub-budget 已用盡或裁切。`,
  })
  if (duplicate) context.diagnostics.push({ code: 'duplicate', path, parentPath, message: '內容與較早 source 完全重複，保留 provenance 但不重複注入。' })
}

function unavailableSource(context: ResolverContext, request: MetadataRequest, path: string, code: InstructionDiagnosticCode, message: string): void {
  const unavailableHash = hash(`unavailable:${path}`)
  context.diagnostics.push({ code, path, parentPath: request.parentPath, message })
  context.sources.push(Object.freeze({
    id: hash(`${request.kind}:${path}:${request.parentPath || ''}:${request.includeDepth}:${unavailableHash}`),
    kind: request.kind,
    scope: request.scope,
    path,
    ...(request.parentPath ? { parentPath: request.parentPath } : {}),
    directoryDepth: request.directoryDepth,
    includeDepth: request.includeDepth,
    revision: context.input.globalRevision,
    bytes: -1,
    bytesKnown: false,
    includedBytes: 0,
    droppedBytes: 0,
    hash: unavailableHash,
    applied: false,
    deduplicated: false,
    truncated: false,
    shadowed: request.shadowed,
    effectiveOrder: null,
    metadataStatus: 'unavailable',
    openable: false,
    content: '',
  }))
}

function metadataSource(context: ResolverContext, request: MetadataRequest, path: string, bytes: number, contentHash: string, metadataStatus: 'content' | 'metadata' | 'unavailable' | 'unauthorized'): void {
  context.sources.push(Object.freeze({
    id: hash(`${request.kind}:${path}:${request.parentPath || ''}:${request.includeDepth}:${contentHash}`),
    kind: request.kind,
    scope: request.scope,
    path,
    ...(request.parentPath ? { parentPath: request.parentPath } : {}),
    directoryDepth: request.directoryDepth,
    includeDepth: request.includeDepth,
    revision: context.input.globalRevision,
    bytes,
    bytesKnown: bytes >= 0,
    includedBytes: 0,
    droppedBytes: Math.max(0, bytes),
    hash: contentHash,
    applied: false,
    deduplicated: false,
    truncated: false,
    shadowed: request.shadowed,
    effectiveOrder: null,
    metadataStatus,
    openable: metadataStatus === 'content' && request.scope === 'project' && Boolean(context.projectRoot && within(context.projectRoot, path)),
    content: '',
  }))
}

async function safeStat(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const info = await stat(path)
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch { return undefined }
}

function discoveredOutsideBoundary(context: ResolverContext, request: MetadataRequest, canonical: string): boolean {
  const unauthorizedProjectInclude = request.scope === 'project'
    && request.kind === 'include'
    && Boolean(context.includeBoundary)
    && !within(context.includeBoundary, canonical)
    && !context.authorized.has(canonical)
  return unauthorizedProjectInclude || Boolean(context.discoveryBoundary && !within(context.discoveryBoundary, canonical))
}

async function recordUnauthorizedMetadata(context: ResolverContext, request: MetadataRequest, canonical: string): Promise<void> {
  const statInfo = await safeStat(canonical)
  const escapedHash = statInfo ? metadataHash(canonical, statInfo, 'unauthorized') : hash(`unauthorized:${canonical}`)
  context.diagnostics.push({ code: 'unauthorized', path: canonical, parentPath: request.parentPath, message: 'source 逃離 canonical project boundary，未加入 effective text。' })
  metadataSource(context, request, canonical, statInfo?.size ?? -1, escapedHash, statInfo ? 'unauthorized' : 'unavailable')
}

async function addDiscoveredMetadata(context: ResolverContext, request: MetadataRequest): Promise<void> {
  if (context.sources.length >= context.limits.maxSources) {
    context.diagnostics.push({ code: 'source-count-limit', path: request.requested, parentPath: request.parentPath, message: 'instruction source count 超過上限。' })
    return
  }
  let canonical: string
  try {
    canonical = await canonicalExisting(request.requested)
  } catch (error) {
    const code = request.failureCode || 'missing'
    unavailableSource(context, request, request.requested, code, error instanceof Error ? error.message : 'source 不存在。')
    return
  }
  if (discoveredOutsideBoundary(context, request, canonical)) {
    await recordUnauthorizedMetadata(context, request, canonical)
    return
  }
  try {
    await access(canonical, constants.R_OK)
    const raw = await readFile(canonical, 'utf8')
    metadataSource(context, request, canonical, Buffer.byteLength(raw), hash(raw), 'content')
  } catch (error) {
    const statInfo = await safeStat(canonical)
    const unreadableHash = statInfo ? metadataHash(canonical, statInfo, 'unreadable') : hash(`unreadable:${canonical}`)
    context.diagnostics.push({ code: 'unreadable', path: canonical, parentPath: request.parentPath, message: error instanceof Error ? error.message : 'source 無法讀取。' })
    metadataSource(context, request, canonical, statInfo?.size ?? -1, unreadableHash, statInfo ? 'metadata' : 'unavailable')
  }
}

function includeMetadataRequest(requested: string, kind: InstructionSourceKind, parentPath: string | undefined, directoryDepth: number, scope: 'global' | 'project', includeDepth: number, failureCode?: MetadataRequest['failureCode']): MetadataRequest {
  return { requested, kind, parentPath, directoryDepth, failureCode, shadowed: false, includeDepth, scope }
}

async function expandDirectiveLines(context: ResolverContext, content: string, applied: boolean, ownerScope: 'global' | 'project', parentPath: string | undefined, depth: number, directoryDepth: number): Promise<string> {
  const expanded: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*@([^\s].*?)\s*$/)
    if (!match) { if (applied) expanded.push(line); continue }
    const targetText = match[1].trim()
    if (/^[a-z]+:\/\//i.test(targetText)) {
      context.diagnostics.push({ code: 'unsupported-target', path: targetText, parentPath, message: '只支援本機檔案 include。' })
      continue
    }
    if (ownerScope === 'global' && !isAbsolute(targetText)) {
      context.diagnostics.push({ code: 'unsupported-target', path: targetText, parentPath, message: 'global include 必須是 absolute local path。' })
      continue
    }
    const target = isAbsolute(targetText) ? targetText : resolve(dirname(parentPath || context.projectRoot), targetText)
    const childDepth = ownerScope === 'global' && parentPath === undefined ? depth : depth + 1
    expanded.push(await expandFile(context, target, ownerScope, 'include', parentPath, childDepth, directoryDepth))
  }
  return expanded.join('\n')
}

async function expandFile(context: ResolverContext, requested: string, ownerScope: 'global' | 'project', kind: InstructionSourceKind, parentPath?: string, depth = 0, directoryDepth = 0): Promise<string> {
  if (depth > context.limits.maxDepth) {
    context.diagnostics.push({ code: 'depth-limit', path: requested, parentPath, message: 'include depth 超過上限。' })
    await addDiscoveredMetadata(context, includeMetadataRequest(requested, 'include', parentPath, directoryDepth, ownerScope, depth))
    return ''
  }
  if (context.sources.length >= context.limits.maxSources) {
    context.diagnostics.push({ code: 'source-count-limit', path: requested, parentPath, message: 'instruction source count 超過上限。' })
    return ''
  }
  let canonical: string
  try { canonical = await canonicalExisting(requested) } catch {
    await addDiscoveredMetadata(context, includeMetadataRequest(requested, 'include', parentPath, directoryDepth, ownerScope, depth, 'missing'))
    return ''
  }
  if (ownerScope === 'project' && kind === 'include' && context.includeBoundary && !within(context.includeBoundary, canonical) && !context.authorized.has(canonical)) {
    await addDiscoveredMetadata(context, includeMetadataRequest(canonical, 'include', parentPath, directoryDepth, ownerScope, depth, 'unauthorized'))
    return ''
  }
  if (context.activePaths.has(canonical)) {
    context.diagnostics.push({ code: 'cycle', path: canonical, parentPath, message: '偵測到 include cycle。' })
    await addDiscoveredMetadata(context, includeMetadataRequest(canonical, 'include', parentPath, directoryDepth, ownerScope, depth))
    return ''
  }
  context.activePaths.add(canonical)
  try {
    await access(canonical, constants.R_OK)
    const raw = await readFile(canonical, 'utf8')
    const own = addText(context, { kind, scope: ownerScope, content: raw, path: canonical, parentPath, directoryDepth, includeDepth: depth })
    if (!own.traverse) return ''
    return await expandDirectiveLines(context, own.content, own.applied, ownerScope, canonical, depth, directoryDepth)
  } catch {
    await addDiscoveredMetadata(context, { ...includeMetadataRequest(requested, kind, parentPath, directoryDepth, ownerScope, depth, 'unreadable') })
    return ''
  } finally { context.activePaths.delete(canonical) }
}

function reserveHeading(context: ResolverContext, blockCount: number, scope: 'global' | 'project', heading: string, path?: string): boolean {
  const separatorBytes = blockCount > 0 ? 2 : 0
  const bytes = Buffer.byteLength(`${heading}\n`) + separatorBytes
  if (bytes > context.remaining || bytes > context.slotRemaining[scope]) {
    context.diagnostics.push({
      code: 'total-budget',
      path,
      message: bytes > context.remaining
        ? 'instruction total budget 無法容納 source heading。'
        : `${scope === 'global' ? 'global personalization' : 'project instructions'} sub-budget 無法容納 source heading。`,
    })
    return false
  }
  context.remaining -= bytes
  context.slotRemaining[scope] -= bytes
  return true
}

function projectLayers(context: ResolverContext): ProjectLayer[] {
  const workDirs: string[] = []
  let cursor = context.workPath
  while (within(context.projectRoot, cursor)) {
    workDirs.unshift(cursor)
    if (cursor === context.projectRoot) break
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  const parentDirs: string[] = []
  if (context.discoveryBoundary !== context.projectRoot && within(context.discoveryBoundary, context.projectRoot)) {
    let parent = dirname(context.projectRoot)
    while (within(context.discoveryBoundary, parent)) {
      parentDirs.unshift(parent)
      if (parent === context.discoveryBoundary) break
      const next = dirname(parent)
      if (next === parent) break
      parent = next
    }
  }
  return [
    ...parentDirs.map((directory, index) => ({ directory, directoryDepth: index - parentDirs.length, parent: true })),
    ...workDirs.map((directory, index) => ({ directory, directoryDepth: index, parent: false })),
  ]
}

function projectSourceKind(context: ResolverContext, layer: ProjectLayer, chosen: { kind: InstructionSourceKind }): InstructionSourceKind {
  if (chosen.kind !== 'project-directory') return chosen.kind
  if (layer.parent) return 'project-parent'
  return layer.directory === context.projectRoot ? 'project-root' : 'project-directory'
}

function shadowSourceKind(context: ResolverContext, layer: ProjectLayer, path: string): InstructionSourceKind {
  const name = basename(path)
  if (name === 'AGENTS.override.md') return 'project-override'
  if (name === 'AGENTS.md' || name === 'CLAUDE.md') return projectSourceKind(context, layer, { kind: 'project-directory' })
  return 'fallback'
}

async function discoverProjectLayer(context: ResolverContext, blocks: readonly SourceBlock[], layer: ProjectLayer, fallbacks: readonly string[]): Promise<{ block: SourceBlock | null; stop: boolean }> {
  if (context.sources.length >= context.limits.maxSources) {
    context.diagnostics.push({ code: 'source-count-limit', path: layer.directory, message: 'instruction source count 超過上限，停止後續 discovery。' })
    return { block: null, stop: true }
  }
  const chosen = await chosenInstruction(layer.directory, fallbacks)
  if (!chosen) return { block: null, stop: false }
  const kind = projectSourceKind(context, layer, chosen)
  const heading = `## 專案指令：${chosen.path}`
  if (!reserveHeading(context, blocks.length, 'project', heading, chosen.path)) return { block: null, stop: true }
  const expanded = await expandFile(context, chosen.path, 'project', kind, undefined, 0, layer.directoryDepth)
  for (const path of chosen.shadowed) await addDiscoveredMetadata(context, { requested: path, kind: shadowSourceKind(context, layer, path), directoryDepth: layer.directoryDepth, shadowed: true, includeDepth: 0, scope: 'project' })
  return { block: expanded.trim() ? { scope: 'project', text: `${heading}\n${expanded}`, order: layer.directoryDepth } : null, stop: false }
}

async function discoverProjectSources(context: ResolverContext): Promise<SourceBlock[]> {
  if (!context.projectRoot) return []
  const fallbacks = safeFallbackNames(context.input.fallbackFilenames)
  const blocks: SourceBlock[] = []
  for (const layer of [...projectLayers(context)].reverse()) {
    const result = await discoverProjectLayer(context, blocks, layer, fallbacks)
    if (result.block) blocks.push(result.block)
    if (result.stop) break
    if (context.sources.length >= context.limits.maxSources) break
  }
  return blocks.sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
}

async function appendGlobalCustom(context: ResolverContext, blocks: SourceBlock[], existingBlockCount: number, presence: InstructionPresence): Promise<void> {
  const content = context.input.globalCustomInstructions.trim() ? context.input.globalCustomInstructions : presence === 'blank' ? LEGACY_DEFAULT_AGENTS : ''
  if (!content.trim() || !reserveHeading(context, blocks.length + existingBlockCount, 'global', '## 全域自訂指令')) return
  const raw = addText(context, { kind: 'global-custom', scope: 'global', content })
  if (!raw.traverse) return
  const expanded = await expandDirectiveLines(context, raw.content, raw.applied, 'global', undefined, 1, 0)
  if (expanded.trim()) blocks.push({ scope: 'global', text: `## 全域自訂指令\n${expanded}` })
}

function appendGlobalBlock(context: ResolverContext, blocks: SourceBlock[], existingBlockCount: number, heading: string, content: string | undefined, presence?: InstructionPresence, blankFallback?: string): void {
  const effectiveContent = content?.trim() ? content : presence === 'blank' ? blankFallback : undefined
  if (!effectiveContent?.trim() || !reserveHeading(context, blocks.length + existingBlockCount, 'global', heading)) return
  const added = addText(context, { kind: 'personality', scope: 'global', content: effectiveContent })
  if (added.applied && added.content.trim()) blocks.push({ scope: 'global', text: `${heading}\n${added.content}` })
}

async function assembleGlobalSources(context: ResolverContext, existingBlockCount: number): Promise<{ blocks: SourceBlock[]; presence: { globalCustomInstructions: InstructionPresence; advancedPersonalityInstructions: InstructionPresence } }> {
  const blocks: SourceBlock[] = []
  const globalPresence = presenceOf(context.input.globalCustomInstructions, context.input.globalCustomInstructionsPresence)
  const advancedPresence = presenceOf(context.input.advancedPersonalityInstructions, context.input.advancedPersonalityInstructionsPresence)
  await appendGlobalCustom(context, blocks, existingBlockCount, globalPresence)
  appendGlobalBlock(context, blocks, existingBlockCount, '## 進階人格指令', context.input.advancedPersonalityInstructions, advancedPresence, LEGACY_DEFAULT_SOUL)
  appendGlobalBlock(context, blocks, existingBlockCount, '## 人格', context.input.personality ? (PERSONALITY_TEXT[context.input.personality] ?? context.input.personality) : undefined)
  appendGlobalBlock(context, blocks, existingBlockCount, '## 關於使用者', context.input.aboutUser)
  appendGlobalBlock(context, blocks, existingBlockCount, '## 回覆偏好', context.input.responseStyle)
  return { blocks, presence: { globalCustomInstructions: globalPresence, advancedPersonalityInstructions: advancedPresence } }
}

function orderedSources(context: ResolverContext): InstructionSource[] {
  const base = [...context.sources].sort((left, right) => Number(left.scope === 'project') - Number(right.scope === 'project') || left.directoryDepth - right.directoryDepth)
  const effectiveOrderById = new Map<string, number>()
  for (const source of base) if (source.applied) effectiveOrderById.set(source.id, effectiveOrderById.size + 1)
  return base.map((source) => Object.freeze({ ...source, effectiveOrder: source.applied ? effectiveOrderById.get(source.id) ?? null : null }))
}

function finalizeInstructionSnapshot(context: ResolverContext, globalBlocks: SourceBlock[], projectBlocks: SourceBlock[], presence: { globalCustomInstructions: InstructionPresence; advancedPersonalityInstructions: InstructionPresence }): InstructionSnapshot {
  const blocks = [...globalBlocks, ...projectBlocks]
  const effectiveText = blocks.map((block) => block.text).join('\n\n').trim()
  const globalText = globalBlocks.map((block) => block.text).join('\n\n').trim()
  const projectText = projectBlocks.map((block) => block.text).join('\n\n').trim()
  const effectiveBytes = Buffer.byteLength(effectiveText)
  const projectInstructionBytes = Buffer.byteLength(projectText) + (globalText && projectText ? 2 : 0)
  const sources = orderedSources(context)
  const snapshotPresence = Object.freeze(presence)
  const identity = hash(JSON.stringify({ revision: context.input.globalRevision, projectRoot: context.projectRoot, workPath: context.workPath, presence: snapshotPresence, sources: sources.map((source) => [source.id, source.hash, source.applied]) }))
  return Object.freeze({
    id: `ins_${identity.slice(0, 20)}`,
    revision: context.input.globalRevision,
    ...(context.projectRoot ? { projectIdentity: context.projectRoot, workPath: context.workPath } : {}),
    effectiveHash: hash(effectiveText),
    effectiveText,
    globalEffectiveText: globalText,
    presence: snapshotPresence,
    sources: Object.freeze(sources),
    diagnostics: Object.freeze(context.diagnostics),
    usage: Object.freeze({
      personalizationBytes: Buffer.byteLength(globalText),
      personalizationBudgetBytes: Math.min(context.limits.personalizationBytes, context.limits.totalBytes),
      projectInstructionBytes,
      projectInstructionBudgetBytes: Math.min(context.limits.projectInstructionBytes, context.limits.totalBytes),
      totalBytes: effectiveBytes,
      budgetBytes: context.limits.totalBytes,
      lowerAuthorityAvailableBytes: Math.max(0, context.limits.totalBytes - effectiveBytes),
    }),
    deliveryMode: 'explicit',
    exactSnapshot: true,
  })
}

export async function resolveInstructionSnapshot(input: ResolveInstructionInput): Promise<InstructionSnapshot> {
  const context = await makeResolverContext(input)
  await recoverInstructionSources(context)
  const projectBlocks = await discoverProjectSources(context)
  const global = await assembleGlobalSources(context, projectBlocks.length)
  return finalizeInstructionSnapshot(context, global.blocks, projectBlocks, global.presence)
}
