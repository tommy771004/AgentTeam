/**
 * Compact, renderer-local evidence index.
 *
 * The index deliberately stores references and small metadata only. Full
 * transcripts, diffs, and generated files remain in their existing owners.
 */

export const ARTIFACT_INDEX_STORAGE_KEY = 'subagents.artifactIndex.v1'
export const ARTIFACT_INDEX_VERSION = 1

export type ArtifactEvidenceType =
  | 'spec'
  | 'ticket'
  | 'test'
  | 'diff'
  | 'review'
  | 'decision'
  | 'final-output'

export type ArtifactEntryStatus = 'pending' | 'complete' | 'failed' | 'stale' | 'missing'
export type ArtifactIndexStatus = 'active' | 'complete' | 'failed' | 'stale'

export type ArtifactIndexEntry = {
  /** Deterministic within an index: type + source, not a random run-local id. */
  id: string
  type: ArtifactEvidenceType
  status: ArtifactEntryStatus
  source: string
  revision?: number
  digest?: string
  at: string
  title?: string
  detail?: string
}

export type ArtifactIndex = {
  id: string
  threadId: string
  runId: string
  status: ArtifactIndexStatus
  currentStatus: string
  decisions: string[]
  blockers: string[]
  suggestedNextSkills: string[]
  updatedAt: string
  entries: ArtifactIndexEntry[]
}

export type ArtifactEvidence = {
  type: ArtifactEvidenceType
  source: string
  status: ArtifactEntryStatus
  title?: string
  detail?: string
  revision?: number
  digest?: string
}

export type ArtifactRunInput = {
  threadId: string
  runId: string
  objective: string
  status: string
  result?: string
  blockers?: string[]
  decisions?: string[]
  suggestedNextSkills?: string[]
  evidence: ArtifactEvidence[]
  generatedAt?: string
}

export type ArtifactRunEvidenceContext = {
  threadId: string
  runId: string
  objective: string
  status: string
  result?: string
  diff?: string
  projectRoot?: string
  operations?: Array<{ id: string; kind: string; title: string; ok?: boolean }>
  plan?: Array<{ id: string; text: string; status: string }>
  review?: { source: string; status: ArtifactEntryStatus; detail?: string }
}

type ArtifactIndexEnvelope = {
  version: number
  indexes: ArtifactIndex[]
}

const MAX_TEXT = 600
const MAX_LIST_ITEMS = 24

function compact(value: unknown, max = MAX_TEXT): string {
  return String(value ?? '')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 32 || code === 9
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function compactList(values: string[] | undefined): string[] {
  return [...new Set((values || []).map((value) => compact(value, 240)).filter(Boolean))].slice(
    0,
    MAX_LIST_ITEMS,
  )
}

function normalizeStatus(status: string): ArtifactIndexStatus {
  if (status === 'success' || status === 'complete' || status === 'delivered') return 'complete'
  if (status === 'stale') return 'stale'
  if (status === 'failed' || status === 'halted' || status === 'error') return 'failed'
  return 'active'
}

function entryStatus(status: string): ArtifactEntryStatus {
  if (status === 'complete' || status === 'success') return 'complete'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'stale') return 'stale'
  if (status === 'missing') return 'missing'
  return 'pending'
}

function stableEntryId(type: ArtifactEvidenceType, source: string): string {
  return `evidence:${type}:${source}`
}

function stableIndexId(threadId: string, runId: string): string {
  return `artifact:${threadId}:${runId}`
}

/** Small deterministic fingerprint for references; this is not a security hash. */
export function stableDigest(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function normalizeEntry(entry: ArtifactIndexEntry): ArtifactIndexEntry {
  const source = compact(entry.source, 1200)
  return {
    id: entry.id || stableEntryId(entry.type, source),
    type: entry.type,
    status: entryStatus(entry.status),
    source,
    revision: entry.revision == null ? undefined : Math.max(1, Math.floor(entry.revision)),
    digest: entry.digest ? compact(entry.digest, 160) : undefined,
    at: compact(entry.at, 80),
    title: entry.title ? compact(entry.title, 180) : undefined,
    detail: entry.detail ? compact(entry.detail, 360) : undefined,
  }
}

function normalizeIndex(index: ArtifactIndex): ArtifactIndex {
  const entries = new Map<string, ArtifactIndexEntry>()
  for (const entry of index.entries || []) {
    const normalized = normalizeEntry(entry)
    entries.set(normalized.id, normalized)
  }
  return {
    id: index.id || stableIndexId(index.threadId, index.runId),
    threadId: compact(index.threadId, 160),
    runId: compact(index.runId, 160),
    status: normalizeStatus(index.status),
    currentStatus: compact(index.currentStatus, 600),
    decisions: compactList(index.decisions),
    blockers: compactList(index.blockers),
    suggestedNextSkills: compactList(index.suggestedNextSkills),
    updatedAt: compact(index.updatedAt, 80),
    entries: [...entries.values()].slice(0, 200),
  }
}

function isArtifactIndex(value: unknown): value is ArtifactIndex {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ArtifactIndex>
  return Boolean(
    typeof candidate.threadId === 'string' &&
      typeof candidate.runId === 'string' &&
      Array.isArray(candidate.entries),
  )
}

function parseIndexes(value: unknown): ArtifactIndex[] {
  if (value && typeof value === 'object' && 'indexes' in value) {
    const envelope = value as Partial<ArtifactIndexEnvelope>
    if (Array.isArray(envelope.indexes)) {
      return envelope.indexes.filter(isArtifactIndex).map(normalizeIndex)
    }
  }
  // Read the issue-10 single-index shape so existing local data remains usable.
  return isArtifactIndex(value) ? [normalizeIndex(value)] : []
}

export function loadArtifactIndexes(storage?: Storage): ArtifactIndex[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(ARTIFACT_INDEX_STORAGE_KEY)
    if (!raw) return []
    return parseIndexes(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveArtifactIndexes(storage: Storage | undefined, indexes: ArtifactIndex[]): void {
  if (!storage) return
  try {
    const envelope: ArtifactIndexEnvelope = {
      version: ARTIFACT_INDEX_VERSION,
      indexes: indexes.map(normalizeIndex).slice(-80),
    }
    storage.setItem(ARTIFACT_INDEX_STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    /* localStorage is optional and quota failures must not affect a run */
  }
}

export function upsertArtifactIndex(storage: Storage | undefined, index: ArtifactIndex): ArtifactIndex {
  const next = normalizeIndex(index)
  if (!storage) return next
  const indexes = loadArtifactIndexes(storage)
  const existing = indexes.findIndex(
    (item) => item.threadId === next.threadId && item.runId === next.runId,
  )
  if (existing >= 0) indexes[existing] = next
  else indexes.push(next)
  saveArtifactIndexes(storage, indexes)
  return next
}

export function recordArtifactEvidence(
  index: ArtifactIndex,
  evidence: ArtifactEvidence,
  at = new Date().toISOString(),
): ArtifactIndex {
  const source = compact(evidence.source, 1200)
  const id = stableEntryId(evidence.type, source)
  const nextEntry = normalizeEntry({
    id,
    type: evidence.type,
    status: entryStatus(evidence.status),
    source,
    revision: evidence.revision,
    digest: evidence.digest,
    at,
    title: evidence.title,
    detail: evidence.detail,
  })
  const entries = [...index.entries]
  const existing = entries.findIndex((entry) => entry.id === id)
  if (existing >= 0) entries[existing] = nextEntry
  else entries.push(nextEntry)
  return normalizeIndex({ ...index, updatedAt: at, entries })
}

export function buildArtifactIndexFromRun(input: ArtifactRunInput): ArtifactIndex {
  const generatedAt = input.generatedAt || new Date().toISOString()
  const index: ArtifactIndex = {
    id: stableIndexId(input.threadId, input.runId),
    threadId: input.threadId,
    runId: input.runId,
    status: normalizeStatus(input.status),
    currentStatus: compact(input.result || input.status, 600),
    decisions: compactList(input.decisions),
    blockers: compactList(input.blockers),
    suggestedNextSkills: compactList(input.suggestedNextSkills),
    updatedAt: generatedAt,
    entries: [],
  }
  let next = index
  for (const evidence of input.evidence) next = recordArtifactEvidence(next, evidence, generatedAt)
  return next
}

export function recordArtifactRun(
  storage: Storage | undefined,
  input: ArtifactRunInput,
): ArtifactIndex {
  return upsertArtifactIndex(storage, buildArtifactIndexFromRun(input))
}

export function buildArtifactEvidenceFromRun(
  input: ArtifactRunEvidenceContext,
): ArtifactEvidence[] {
  const evidence: ArtifactEvidence[] = [
    {
      type: 'spec',
      source: `thread:${input.threadId}/objective`,
      title: 'Task specification reference',
      status: 'complete',
      revision: 1,
    },
    {
      type: 'final-output',
      source: `run:${input.runId}/summary`,
      title: 'Run final output reference',
      status: input.status === 'success' ? 'complete' : 'failed',
      detail: input.result,
      revision: 1,
    },
  ]
  const ticket = input.objective.match(/(?:ticket|issue|#)[\s:_-]*([A-Za-z0-9][A-Za-z0-9._/-]*)/i)?.[1]
  if (ticket) {
    evidence.push({
      type: 'ticket',
      source: `ticket:${ticket}`,
      title: 'Ticket reference',
      status: 'complete',
      revision: 1,
    })
  }
  const testOperations = (input.operations || []).filter((operation) =>
    /test|smoke|lint|build|typecheck|verify/i.test(
      `${operation.kind} ${operation.title}`,
    ),
  )
  for (const operation of testOperations.slice(-12)) {
    evidence.push({
      type: 'test',
      source: `operation:${operation.id}`,
      title: operation.title,
      status: operation.ok === false ? 'failed' : 'complete',
      revision: 1,
    })
  }
  if (input.diff) {
    evidence.push({
      type: 'diff',
      source: `git:${input.projectRoot || 'workspace'}/working-tree`,
      title: 'Working tree diff reference',
      status: 'complete',
      digest: stableDigest(input.diff),
      revision: 1,
    })
  }
  const reviewOperation = (input.operations || []).find((operation) =>
    /review|critique|audit/i.test(`${operation.kind} ${operation.title}`),
  )
  if (input.review || reviewOperation) {
    evidence.push({
      type: 'review',
      source: input.review?.source || `operation:${reviewOperation?.id || 'review'}`,
      title: 'Review reference',
      status: input.review?.status || (reviewOperation?.ok === false ? 'failed' : 'complete'),
      detail: input.review?.detail,
      revision: 1,
    })
  }
  if (input.plan?.length) {
    evidence.push({
      type: 'decision',
      source: `thread:${input.threadId}/plan`,
      title: 'Execution decision reference',
      status: 'complete',
      detail: `${input.plan.filter((item) => item.status === 'done').length}/${input.plan.length} plan items completed`,
      revision: 1,
    })
  }
  return evidence
}

export function getLatestArtifactIndex(
  storage: Storage | undefined,
  threadId: string,
): ArtifactIndex | null {
  return (
    loadArtifactIndexes(storage)
      .filter((index) => index.threadId === threadId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null
  )
}

function hasStaleReference(index: ArtifactIndex): boolean {
  return index.entries.some((entry) => entry.status === 'stale' || entry.status === 'missing')
}

export function buildHandoffDocument(input: {
  threadId: string
  runId: string
  index: ArtifactIndex
  generatedAt?: string
}): string {
  const generatedAt = input.generatedAt || new Date().toISOString()
  const stale = hasStaleReference(input.index)
  const lines = [
    '# SubAgents AI Handoff',
    '',
    `- Thread: ${compact(input.threadId, 160)}`,
    `- Run: ${compact(input.runId, 160)}`,
    `- Generated: ${generatedAt}`,
    `- Artifact Index: ${compact(input.index.id || 'local', 180)}`,
    `- Status: ${stale ? '需檢查 references (STALE/MISSING)' : input.index.status}`,
    '',
    '## Current status',
    '',
    input.index.currentStatus || input.index.status,
    '',
    '## Decisions',
    '',
    ...(input.index.decisions.length ? input.index.decisions.map((item) => `- ${item}`) : ['- None recorded']),
    '',
    '## Blockers',
    '',
    ...(input.index.blockers.length ? input.index.blockers.map((item) => `- ${item}`) : ['- None recorded']),
    '',
    '## Suggested next skills',
    '',
    ...(input.index.suggestedNextSkills.length
      ? input.index.suggestedNextSkills.map((item) => `- ${item}`)
      : ['- None recorded']),
    '',
    '## References',
    '',
  ]

  for (const entry of input.index.entries) {
    const revision = entry.revision == null ? '' : ` · revision ${entry.revision}`
    const digest = entry.digest ? ` · ${entry.digest}` : ''
    const state = entry.status === 'stale' || entry.status === 'missing' ? entry.status.toUpperCase() : entry.status
    lines.push(
      `- [${state}] ${entry.type}: ${entry.title ? `${entry.title} · ` : ''}${entry.source}${revision}${digest} (${entry.at})`,
    )
    if (entry.detail) lines.push(`  - ${entry.detail}`)
  }

  lines.push(
    '',
    '> This is a repeatable local Handoff. It references existing evidence; it does not copy the full transcript, duplicate large artifacts, deliver, or upload anything.',
    stale
      ? '> Delivery was not performed: one or more references are stale or missing and require review.'
      : '> Delivery was not performed: this file was generated locally only.',
    '',
  )
  return lines.join('\n')
}

export function readArtifactIndex(storage: Storage | undefined, threadId: string): ArtifactIndex | null {
  return getLatestArtifactIndex(storage, threadId)
}
