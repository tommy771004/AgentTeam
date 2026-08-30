import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  ReviewFileManifestEntry,
  ReviewPageEnvelope,
  ReviewTarget,
  ReviewWorkspaceBinding,
} from '../src/agent/reviewContract.ts'
import type { ReviewArtifactProjection, ReviewArtifactStore } from './reviewArtifactStore.ts'
import { captureRunReviewSnapshot } from './reviewSnapshotCapture.ts'
import { captureReviewWorkspaceAdmission } from './reviewWorkspaceBinding.ts'

const exec = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_FILE_PAGE = 200
const MAX_HUNK_PAGE_BYTES = 256 * 1024

export type ReviewTargetDescription = {
  target: ReviewTarget
  revision: string
  immutable: boolean
  refreshable: boolean
  mutationCapable: boolean
  status: 'ready' | 'partial' | 'missing' | 'stale'
  fileCount: number
  diagnostics: string[]
}

export type ReviewDiffHunk = {
  id: string
  header: string
  content: string
  bytes: number
}

export class WorkspaceReviewProjectionError extends Error {
  readonly code: 'invalid' | 'missing' | 'stale' | 'cancelled' | 'timeout' | 'unavailable'

  constructor(code: 'invalid' | 'missing' | 'stale' | 'cancelled' | 'timeout' | 'unavailable', message: string) {
    super(message)
    this.name = 'WorkspaceReviewProjectionError'
    this.code = code
  }
}

type LoadedTarget = {
  description: ReviewTargetDescription
  manifest: ReviewFileManifestEntry[]
  payloads: Map<string, string>
  /** Immutable snapshot payloads stay referenced until one file is opened. */
  payloadRefs: Map<string, { snapshotId: string; payloadId: string }>
}

export type WorkspaceReviewProjectionOptions = {
  store: ReviewArtifactStore
  resolveWorkspace: (workspaceId: string) => Promise<ReviewWorkspaceBinding | undefined> | ReviewWorkspaceBinding | undefined
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function targetKey(target: ReviewTarget): string {
  return JSON.stringify(target)
}

function cursorIndex(cursor?: string): number {
  if (!cursor) return 0
  const value = Number(cursor)
  if (!Number.isSafeInteger(value) || value < 0) throw new WorkspaceReviewProjectionError('invalid', 'Invalid review page cursor')
  return value
}

async function bounded<T>(operation: Promise<T>, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  if (signal?.aborted) throw new WorkspaceReviewProjectionError('cancelled', 'Review request was cancelled')
  let timer: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkspaceReviewProjectionError('timeout', 'Review request timed out')), Math.max(1, timeoutMs))
  })
  const cancelled = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new WorkspaceReviewProjectionError('cancelled', 'Review request was cancelled'))
    signal?.addEventListener('abort', abortHandler, { once: true })
  })
  try {
    return await Promise.race(signal ? [operation, timeout, cancelled] : [operation, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (abortHandler) signal?.removeEventListener('abort', abortHandler)
  }
}

async function readSnapshotPayload(
  store: ReviewArtifactStore,
  source: { snapshotId: string; payloadId: string },
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = []
  let offset = 0
  let total = 0
  for (;;) {
    const page = await store.readPayloadPage({
      snapshotId: source.snapshotId,
      payloadId: source.payloadId,
      offset,
      maxBytes: MAX_HUNK_PAGE_BYTES,
    })
    chunks.push(Buffer.from(page.content))
    total += page.content.byteLength
    if (page.nextOffset === undefined) return { text: Buffer.concat(chunks).toString('utf8'), truncated: false }
    if (total >= 8 * 1024 * 1024) return { text: Buffer.concat(chunks).toString('utf8'), truncated: true }
    offset = page.nextOffset
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    return (await exec('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout
  } catch (error) {
    const failure = error as { stderr?: string }
    throw new WorkspaceReviewProjectionError('unavailable', (failure.stderr || `git ${args[0]} failed`).trim())
  }
}

function zeroFields(value: string): string[] {
  return value.split('\0').filter(Boolean)
}

function parseChanges(value: string): Array<{ status: ReviewFileManifestEntry['status']; path: string; oldPath?: string }> {
  const fields = zeroFields(value)
  const result: Array<{ status: ReviewFileManifestEntry['status']; path: string; oldPath?: string }> = []
  for (let index = 0; index < fields.length;) {
    const statusValue = fields[index++] || ''
    const code = statusValue[0]
    if (code === 'R' || code === 'C') {
      const oldPath = fields[index++] || ''
      const path = fields[index++] || ''
      result.push({ status: code === 'R' ? 'renamed' : 'copied', oldPath, path })
    } else {
      const path = fields[index++] || ''
      result.push({
        status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : code === 'T' ? 'type-changed' : 'modified',
        path,
      })
    }
  }
  return result.filter((item) => item.path)
}

async function loadGitRange(
  target: Extract<ReviewTarget, { kind: 'staged' | 'branch-range' }>,
  workspace: ReviewWorkspaceBinding,
): Promise<LoadedTarget> {
  if (workspace.mode !== 'git' || !workspace.worktreeRoot) throw new WorkspaceReviewProjectionError('unavailable', 'Git review target has no worktree')
  const cwd = workspace.worktreeRoot
  const scope = target.kind === 'staged' ? ['--cached'] : [target.baseRef, target.headRef]
  const changes = parseChanges(await git(cwd, ['diff', '--name-status', '-z', '--find-renames', '--find-copies', ...scope, '--']))
  const payloads = new Map<string, string>()
  const manifest: ReviewFileManifestEntry[] = []
  for (const change of changes) {
    const paths = change.oldPath ? [change.oldPath, change.path] : [change.path]
    const patch = await git(cwd, ['diff', '--binary', '--no-ext-diff', '--find-renames', '--find-copies', ...scope, '--', ...paths])
    const payloadRef = `patch_${digest(`${change.path}\0${patch}`).slice(0, 32)}`
    payloads.set(payloadRef, patch)
    manifest.push({ ...change, binary: /GIT binary patch|Binary files/.test(patch), payloadRef })
  }
  const revision = target.kind === 'staged'
    ? target.revision
    : digest(`${target.baseRef}\0${target.headRef}\0${await git(cwd, ['rev-parse', target.baseRef, target.headRef])}`)
  return {
    description: {
      target,
      revision,
      immutable: target.kind === 'branch-range',
      refreshable: target.kind === 'staged',
      mutationCapable: target.kind === 'staged',
      status: 'ready',
      fileCount: manifest.length,
      diagnostics: [],
    },
    manifest,
    payloads,
    payloadRefs: new Map(),
  }
}

function snapshotDescription(target: ReviewTarget, snapshot: ReviewArtifactProjection): ReviewTargetDescription {
  return {
    target,
    revision: snapshot.manifestHash || `${snapshot.snapshotId}:${snapshot.status}`,
    immutable: true,
    refreshable: false,
    mutationCapable: false,
    status: snapshot.status === 'ready' ? 'ready' : snapshot.status === 'partial' ? 'partial' : 'missing',
    fileCount: snapshot.manifest.length,
    diagnostics: [...snapshot.diagnostics],
  }
}

export class WorkspaceReviewProjection {
  private readonly cache = new Map<string, LoadedTarget>()
  private readonly options: WorkspaceReviewProjectionOptions

  constructor(options: WorkspaceReviewProjectionOptions) { this.options = options }

  private async loadSnapshot(target: Extract<ReviewTarget, { kind: 'run-snapshot' }>): Promise<LoadedTarget> {
    let snapshot: ReviewArtifactProjection
    try { snapshot = await this.options.store.read(target.snapshotId) } catch {
      throw new WorkspaceReviewProjectionError('missing', `Run Review Snapshot ${target.snapshotId} is missing`)
    }
    const payloads = new Map<string, string>()
    const payloadRefs = new Map<string, { snapshotId: string; payloadId: string }>()
    for (const entry of snapshot.manifest) {
      if (!entry.payloadRef || payloadRefs.has(entry.payloadRef)) continue
      payloadRefs.set(entry.payloadRef, { snapshotId: snapshot.snapshotId, payloadId: entry.payloadRef })
    }
    return { description: snapshotDescription(target, snapshot), manifest: snapshot.manifest, payloads, payloadRefs }
  }

  private async loadLive(target: Extract<ReviewTarget, { kind: 'live-working-tree' }>): Promise<LoadedTarget> {
    const workspace = await this.options.resolveWorkspace(target.workspaceId)
    if (!workspace) throw new WorkspaceReviewProjectionError('missing', 'Workspace binding is missing')
    const admission = await captureReviewWorkspaceAdmission({ runId: `live:${target.workspaceId}`, projectRoot: workspace.projectRoot, runnerKind: 'builtin' })
    if (!admission.canonical || admission.status === 'failed' || !admission.baseline) throw new WorkspaceReviewProjectionError('unavailable', 'Live workspace capture failed')
    if (target.revision !== admission.baseline.workingRevision) throw new WorkspaceReviewProjectionError('stale', 'Live workspace revision changed; refresh required')
    const captured = await captureRunReviewSnapshot({ admission, threadId: `live:${target.workspaceId}` })
    return {
      description: { target, revision: target.revision, immutable: false, refreshable: true, mutationCapable: true, status: captured.status === 'failed' ? 'partial' : captured.status, fileCount: captured.manifest.length, diagnostics: captured.diagnostics },
      manifest: captured.manifest,
      payloads: new Map(captured.payloads.map((payload) => [payload.payloadId, typeof payload.content === 'string' ? payload.content : Buffer.from(payload.content).toString('utf8')])),
      payloadRefs: new Map(),
    }
  }

  private async loadSnapshotRange(target: Extract<ReviewTarget, { kind: 'snapshot-range' }>): Promise<LoadedTarget> {
    const before = await this.loadSnapshot({ kind: 'run-snapshot', snapshotId: target.beforeSnapshotId })
    const after = await this.loadSnapshot({ kind: 'run-snapshot', snapshotId: target.afterSnapshotId })
    const beforeByPath = new Map(before.manifest.map((entry) => [entry.path, entry]))
    const afterByPath = new Map(after.manifest.map((entry) => [entry.path, entry]))
    const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort()
    const manifest = paths.filter((path) => JSON.stringify(beforeByPath.get(path)) !== JSON.stringify(afterByPath.get(path))).map((path) => {
      const next = afterByPath.get(path)
      const previous = beforeByPath.get(path)
      return next || { ...previous!, status: 'deleted' as const }
    })
    return {
      description: { target, revision: digest(`${before.description.revision}\0${after.description.revision}`), immutable: true, refreshable: false, mutationCapable: false, status: before.description.status === 'partial' || after.description.status === 'partial' ? 'partial' : 'ready', fileCount: manifest.length, diagnostics: [...before.description.diagnostics, ...after.description.diagnostics] },
      manifest,
      payloads: new Map([...before.payloads, ...after.payloads]),
      payloadRefs: new Map([...before.payloadRefs, ...after.payloadRefs]),
    }
  }

  private async load(target: ReviewTarget, force = false): Promise<LoadedTarget> {
    const key = targetKey(target)
    if (!force && this.cache.has(key)) return this.cache.get(key)!
    let loaded: LoadedTarget
    if (target.kind === 'run-snapshot') loaded = await this.loadSnapshot(target)
    else if (target.kind === 'snapshot-range') loaded = await this.loadSnapshotRange(target)
    else {
      const workspace = await this.options.resolveWorkspace(target.workspaceId)
      if (!workspace) throw new WorkspaceReviewProjectionError('missing', 'Workspace binding is missing')
      if (target.kind === 'live-working-tree') loaded = await this.loadLive(target)
      else {
        if (target.kind === 'staged') {
          const current = await captureReviewWorkspaceAdmission({ runId: `staged:${target.workspaceId}`, projectRoot: workspace.projectRoot, runnerKind: 'builtin' })
          if (!current.canonical || !current.baseline) throw new WorkspaceReviewProjectionError('unavailable', 'Staged workspace capture failed')
          if (current.baseline.indexRevision !== target.revision) throw new WorkspaceReviewProjectionError('stale', 'Staged revision changed; refresh required')
        }
        loaded = await loadGitRange(target, workspace)
      }
    }
    this.cache.set(key, loaded)
    return loaded
  }

  async describeTarget(target: ReviewTarget, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ReviewTargetDescription> {
    return (await bounded(this.load(target), options.signal, options.timeoutMs)).description
  }

  async refresh(target: ReviewTarget, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ReviewTargetDescription> {
    if (target.kind !== 'live-working-tree' && target.kind !== 'staged') throw new WorkspaceReviewProjectionError('invalid', 'Immutable review targets cannot be refreshed')
    return (await bounded(this.load(target, true), options.signal, options.timeoutMs)).description
  }

  async listFiles(target: ReviewTarget, input: { cursor?: string; limit?: number; query?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ReviewPageEnvelope<ReviewFileManifestEntry>> {
    const loaded = await bounded(this.load(target), input.signal, input.timeoutMs)
    const query = input.query?.trim().toLocaleLowerCase()
    const all = query ? loaded.manifest.filter((entry) => `${entry.oldPath || ''}\n${entry.path}`.toLocaleLowerCase().includes(query)) : loaded.manifest
    const start = cursorIndex(input.cursor)
    const limit = Math.min(MAX_FILE_PAGE, Math.max(1, input.limit || 50))
    const items = all.slice(start, start + limit)
    const next = start + items.length
    return next >= all.length
      ? { target, revision: loaded.description.revision, items, total: all.length, diagnostics: loaded.description.diagnostics, complete: true }
      : { target, revision: loaded.description.revision, items, total: all.length, diagnostics: loaded.description.diagnostics, complete: false, nextCursor: String(next), omitted: { items: all.length - next, bytes: 0, reasons: ['file-page-limit'] } }
  }

  async readFileDiff(target: ReviewTarget, path: string, input: { cursor?: string; maxBytes?: number; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ReviewPageEnvelope<ReviewDiffHunk>> {
    const loaded = await bounded(this.load(target), input.signal, input.timeoutMs)
    const entry = loaded.manifest.find((candidate) => candidate.path === path || candidate.oldPath === path)
    if (!entry) throw new WorkspaceReviewProjectionError('missing', `Review file ${path} is missing`)
    let patch = entry.payloadRef ? loaded.payloads.get(entry.payloadRef) : undefined
    let payloadTruncated = false
    if (patch === undefined && entry.payloadRef) {
      const source = loaded.payloadRefs.get(entry.payloadRef)
      if (source) {
        const loadedPayload = await readSnapshotPayload(this.options.store, source)
        patch = loadedPayload.text
        payloadTruncated = loadedPayload.truncated
      }
    }
    if (patch === undefined) throw new WorkspaceReviewProjectionError('missing', `Review payload for ${path} is missing`)
    const pieces = patch.split(/(?=^@@ )/m).filter(Boolean)
    const hunks = pieces.map((content, index) => ({ id: `${entry.payloadRef || path}:${index}`, header: content.startsWith('@@ ') ? content.split('\n', 1)[0] : 'file header', content, bytes: Buffer.byteLength(content, 'utf8') }))
    const start = cursorIndex(input.cursor)
    const budget = Math.min(MAX_HUNK_PAGE_BYTES, Math.max(1, input.maxBytes || 64 * 1024))
    const items: ReviewDiffHunk[] = []
    let used = 0
    for (let index = start; index < hunks.length; index += 1) {
      const hunk = hunks[index]
      if (items.length > 0 && used + hunk.bytes > budget) break
      items.push(hunk)
      used += hunk.bytes
      if (used >= budget) break
    }
    const next = start + items.length
    const omittedItems = Math.max(0, hunks.length - next)
    const omittedBytes = hunks.slice(next).reduce((total, hunk) => total + hunk.bytes, 0)
    const diagnostics = payloadTruncated
      ? [...loaded.description.diagnostics, 'payload-source-limit']
      : loaded.description.diagnostics
    return omittedItems === 0 && !payloadTruncated
      ? { target, revision: loaded.description.revision, items, total: hunks.length, diagnostics, complete: true }
      : { target, revision: loaded.description.revision, items, total: hunks.length, diagnostics, complete: false, nextCursor: String(next), omitted: { items: Math.max(omittedItems, payloadTruncated ? 1 : 0), bytes: omittedBytes, reasons: [payloadTruncated ? 'payload-source-limit' : 'hunk-byte-limit'] } }
  }
}
