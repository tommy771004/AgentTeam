import { createHash } from 'node:crypto'
import {
  assertMemoryQuota, canonicalMemoryDraft, canonicalMemoryLogicalKey, memoryScopeKey, rejectProtectedMemoryData,
  DurableMemoryStoreError,
  type DurableMemoryEntry, type DurableMemoryLimits, type DurableMemoryProvenance,
  type MemoryAccessContext, type MemoryEntryDraft, type MemoryScope,
} from './durableMemoryStore.ts'

export type MemoryImportMode = 'skip' | 'overwrite' | 'rename'
export type MemoryImportPreviewInput = { access: MemoryAccessContext; bundle: unknown; mode: MemoryImportMode }
export type MemoryImportApplyInput = MemoryImportPreviewInput & { operationId: string; previewId: string; expectedRevision: number }
export type MemoryImportCounts = { add: number; update: number; conflict: number; invalid: number; quota: number; skipped: number; renamed: number }
export type MemoryImportPreview = {
  revision: number
  previewId: string
  mode: MemoryImportMode
  counts: MemoryImportCounts
  issues: Array<{ index: number; code: string; message: string }>
  targets: Array<{ index: number; scope: MemoryScope; logicalKey: string; action: 'add' | 'update' | 'skip' | 'rename' }>
}
export type MemoryImportResult = { changed: number; revision: number; alreadyApplied: boolean; counts: MemoryImportCounts }
export type MemoryImportReceipt = { hash: string; entryIds: string[]; result: MemoryImportResult }
export type MemoryImportTestHooks = { afterImportEntryWrite?: (index: number) => void }
type ImportDraft = MemoryEntryDraft & { source?: DurableMemoryProvenance; updatedAt: string }
export type MemoryImportPlan = { preview: MemoryImportPreview; drafts: ImportDraft[] }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DurableMemoryStoreError('invalid_bundle', 'Expected a memory bundle object')
  return value as Record<string, unknown>
}

function onlyKeys(row: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(row).some((key) => !allowed.includes(key))) {
    throw new DurableMemoryStoreError('invalid_bundle', 'Unknown authority, approval, instruction or schema metadata is not accepted')
  }
}

export function memoryImportHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function bundleRows(bundle: unknown, limits: DurableMemoryLimits): unknown[] {
  if (Buffer.byteLength(JSON.stringify(bundle) || '', 'utf8') > limits.maxExportBytes) throw new DurableMemoryStoreError('invalid_bundle', 'Memory import exceeds byte limit')
  const row = object(bundle)
  onlyKeys(row, ['schema', 'version', 'generatedAt', 'revision', 'privacy', 'entries'])
  if (row.schema !== 'subagents.durable-memory' || row.version !== 1 || !Array.isArray(row.entries)) {
    throw new DurableMemoryStoreError('invalid_bundle', 'Only subagents.durable-memory schema version 1 is supported')
  }
  canonicalImportTimestamp(row.generatedAt)
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0) throw new DurableMemoryStoreError('invalid_bundle', 'Bundle revision must be a non-negative integer')
  const privacy = object(row.privacy)
  onlyKeys(privacy, ['plaintext', 'warning'])
  if (privacy.plaintext !== true || typeof privacy.warning !== 'string' || privacy.warning.length > 1024) {
    throw new DurableMemoryStoreError('invalid_bundle', 'Bundle must declare plaintext privacy metadata')
  }
  if (row.entries.length > limits.maxImportBatch) throw new DurableMemoryStoreError('invalid_bundle', `Memory import exceeds ${limits.maxImportBatch} entries`)
  return row.entries
}

function canonicalImportTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new DurableMemoryStoreError('invalid_bundle', 'Import timestamps must use canonical ISO format')
  }
  return value
}

export function sourceProvenance(value: unknown, limits: DurableMemoryLimits): DurableMemoryProvenance | undefined {
  if (value === undefined) return undefined
  const source = object(value)
  onlyKeys(source, ['origin', 'operation', 'runId', 'sessionId', 'callId', 'importedFrom'])
  if (!['runtime', 'admin', 'migration', 'consolidation'].includes(String(source.origin)) || typeof source.operation !== 'string') {
    throw new DurableMemoryStoreError('invalid_bundle', 'Invalid source provenance')
  }
  for (const key of ['operation', 'runId', 'sessionId', 'callId']) {
    if (source[key] !== undefined) canonicalMemoryLogicalKey(source[key] as string, limits)
  }
  rejectProtectedMemoryData(Object.values(source).filter((value): value is string => typeof value === 'string'))
  if (source.importedFrom !== undefined) {
    const original = object(source.importedFrom)
    onlyKeys(original, ['origin', 'operation', 'runId', 'sessionId', 'callId'])
    return sourceProvenance(original, limits)
  }
  return structuredClone(source) as DurableMemoryProvenance
}

function importDraft(value: unknown, limits: DurableMemoryLimits): ImportDraft {
  const row = object(value)
  onlyKeys(row, ['id', 'scope', 'logicalKey', 'kind', 'text', 'tags', 'createdAt', 'updatedAt', 'revision', 'provenance'])
  canonicalMemoryLogicalKey(row.id as string, limits)
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0) throw new DurableMemoryStoreError('invalid_bundle', 'Entry revision must be a non-negative integer')
  const scope = object(row.scope)
  onlyKeys(scope, scope.kind === 'global' ? ['kind'] : ['kind', 'project'])
  if (Array.isArray(row.tags) && row.tags.length > limits.maxTags) throw new DurableMemoryStoreError('invalid_input', 'Raw tag count exceeds import limit')
  const draft = canonicalMemoryDraft({ scope: row.scope, logicalKey: row.logicalKey, kind: row.kind, text: row.text, tags: row.tags, createdAt: row.createdAt } as MemoryEntryDraft, limits)
  const updatedAt = canonicalImportTimestamp(row.updatedAt)
  return { ...draft, updatedAt, source: sourceProvenance(row.provenance, limits) }
}

function entryKey(entry: Pick<DurableMemoryEntry, 'scope' | 'logicalKey'>): string {
  return JSON.stringify([memoryScopeKey(entry.scope), entry.logicalKey])
}

function renamedDraft(draft: ImportDraft, occupied: Map<string, DurableMemoryEntry>, limits: DurableMemoryLimits): ImportDraft {
  if (draft.kind !== 'memory') throw new DurableMemoryStoreError('invalid_bundle', 'Global profile/document cannot be renamed; choose skip or overwrite')
  for (let index = 1; index <= limits.maxEntriesPerScope + limits.maxImportBatch; index += 1) {
    const suffix = `~import-${index}`
    const logicalKey = `${draft.logicalKey.slice(0, limits.maxLogicalKeyLength - suffix.length)}${suffix}`
    const renamed = { ...draft, logicalKey: canonicalMemoryLogicalKey(logicalKey, limits) }
    if (!occupied.has(entryKey(renamed))) return renamed
  }
  throw new DurableMemoryStoreError('quota_exceeded', 'No free import rename key within scope quota')
}

function stageEntry(plan: MemoryImportPlan, draft: ImportDraft, index: number, occupied: Map<string, DurableMemoryEntry>, limits: DurableMemoryLimits): void {
  const { preview } = plan
  const existing = occupied.get(entryKey(draft))
  if (existing) preview.counts.conflict += 1
  if (existing && preview.mode === 'skip') {
    preview.counts.skipped += 1
    preview.targets.push({ index, scope: draft.scope, logicalKey: draft.logicalKey, action: 'skip' })
    return
  }
  const target = existing && preview.mode === 'rename' ? renamedDraft(draft, occupied, limits) : draft
  const creates = !occupied.has(entryKey(target))
  assertMemoryQuota(occupied.values(), target.scope, target.logicalKey, limits)
  const action = existing && preview.mode === 'rename' ? 'rename' : creates ? 'add' : 'update'
  preview.counts[creates ? 'add' : 'update'] += 1
  if (action === 'rename') preview.counts.renamed += 1
  preview.targets.push({ index, scope: target.scope, logicalKey: target.logicalKey, action })
  plan.drafts.push(target)
  occupied.set(entryKey(target), { ...target, id: 'staged', revision: 0 })
}

export function planMemoryImport(bundle: unknown, mode: MemoryImportMode, entries: DurableMemoryEntry[], revision: number, limits: DurableMemoryLimits): MemoryImportPlan {
  if (!['skip', 'overwrite', 'rename'].includes(mode)) throw new DurableMemoryStoreError('invalid_input', 'Choose skip, overwrite or rename')
  const rows = bundleRows(bundle, limits)
  const plan: MemoryImportPlan = { drafts: [], preview: { revision, previewId: '', mode,
    counts: { add: 0, update: 0, conflict: 0, invalid: 0, quota: 0, skipped: 0, renamed: 0 }, issues: [], targets: [] } }
  const occupied = new Map(entries.map((entry) => [entryKey(entry), entry]))
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    try {
      const draft = importDraft(row, limits)
      const key = entryKey(draft)
      if (seen.has(key)) throw new DurableMemoryStoreError('invalid_bundle', 'Duplicate scope/key in import batch')
      seen.add(key)
      stageEntry(plan, draft, index, occupied, limits)
    } catch (error) {
      if (!(error instanceof DurableMemoryStoreError)) throw error
      plan.preview.counts[error.code === 'quota_exceeded' ? 'quota' : 'invalid'] += 1
      plan.preview.issues.push({ index, code: error.code, message: error.message })
    }
  })
  plan.preview.previewId = memoryImportHash([bundle, mode, revision, plan.preview.targets])
  return plan
}

export function memoryImportOperationKey(input: MemoryImportApplyInput, limits: DurableMemoryLimits): string {
  const operationId = canonicalMemoryLogicalKey(input.operationId, limits)
  return `import-operation:${memoryImportHash([input.access.origin, operationId])}`
}

export function memoryImportRequestHash(input: MemoryImportApplyInput): string {
  return memoryImportHash([input.access.origin, input.bundle, input.mode, input.previewId, input.expectedRevision])
}

export function replayMemoryImport(receipt: MemoryImportReceipt, input: MemoryImportApplyInput, entries: DurableMemoryEntry[]): MemoryImportResult {
  if (receipt.hash !== memoryImportRequestHash(input)) throw new DurableMemoryStoreError('invalid_input', 'Import operation retried with a different payload')
  const surviving = new Set(entries.map((entry) => entry.id))
  if (receipt.entryIds.some((id) => !surviving.has(id))) throw new DurableMemoryStoreError('not_found', 'Imported entry was deleted; retry will not restore it')
  return { ...structuredClone(receipt.result), changed: 0, alreadyApplied: true }
}

export function checkedMemoryImportPlan(input: MemoryImportApplyInput, entries: DurableMemoryEntry[], revision: number, limits: DurableMemoryLimits): MemoryImportPlan {
  const plan = planMemoryImport(input.bundle, input.mode, entries, revision, limits)
  if (input.expectedRevision !== revision || input.previewId !== plan.preview.previewId) {
    throw new DurableMemoryStoreError('invalid_input', 'Memory changed or preview does not match; preview again before applying')
  }
  if (plan.preview.counts.invalid || plan.preview.counts.quota) {
    throw new DurableMemoryStoreError(plan.preview.counts.quota ? 'quota_exceeded' : 'invalid_bundle', 'Import preview contains invalid/quota errors; nothing was applied')
  }
  return plan
}
