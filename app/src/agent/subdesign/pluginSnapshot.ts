/**
 * Plugin resolved snapshot & capability grant boundary.
 *
 * Records source identity, resolved version/commit, content hash,
 * requested capabilities and granted capabilities. No raw credential
 * ever appears in the snapshot.
 *
 * Project-relative persistence:
 *   <projectRoot>/.subagents/open-design/snapshots/<safeId>.json
 * Path confinement: absolute, traversal, or outside-root => reject.
 */

import { parseOpenDesignPluginManifest, type PluginContractResult } from '../openDesign/pluginContract.ts'

export const SNAPSHOT_DIR = '.subagents/open-design/snapshots'
export const SNAPSHOT_VERSION = 1

/** Capabilities that are deny-by-default per spec 02. */
export const DENY_BY_DEFAULT = new Set<string>([
  'fs:write',
  'subprocess',
  'bash',
  'network',
  'mcp',
  'connector',
])

export type SnapshotSource = {
  sourcePath: string
  sourceUrl?: string
  upstreamCommit?: string
  recordId?: string
}

export type PluginResolvedSnapshot = {
  version: typeof SNAPSHOT_VERSION
  snapshotId: string
  pluginId: string
  source: SnapshotSource
  resolvedVersion?: string
  resolvedCommit?: string
  contentHash: string
  capabilityFingerprint: string
  requestedCapabilities: string[]
  grantedCapabilities: string[]
  grantDecisions: GrantDecision[]
  grantScope?: GrantScope
  grantedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
  projectRelativePath: string
  contractKind: 'legacy' | 'v1'
  specVersion?: string | null
  /** Redacted references only — never raw token. */
  credentialRefs?: Array<{ kind: string; ref: string }>
}

export type GrantDecision = {
  capability: string
  granted: boolean
  decidedAt: string
  runId?: string
  threadId?: string
}

export type GrantScope =
  | { runId: string; threadId?: string }
  | { runId?: string; threadId: string }

// ── Collision-resistant content hash & capability fingerprint ────────────

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 runtime unavailable')
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function fingerprintCapabilities(capabilities: string[]): Promise<string> {
  const sorted = [...new Set(capabilities.map((c) => c.trim()).filter(Boolean))].sort()
  return sha256Hex(sorted.join('|'))
}

// ── Path confinement ────────────────────────────────────────────────────

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)
}

export function normalizeProjectRelative(raw: string): string {
  return raw.replaceAll('\\', '/').replace(/^\.\//, '').trim()
}

export function validateProjectRelativePath(
  projectRoot: string,
  targetPath: string,
): { ok: true; normalized: string } | { ok: false; reason: string } {
  const rel = normalizeProjectRelative(targetPath)
  if (!rel) return { ok: false, reason: '路徑不可為空。' }
  if (isAbsolutePath(rel) || isAbsolutePath(targetPath)) return { ok: false, reason: `絕對路徑不被允許：${targetPath}` }
  if (rel.includes('..')) return { ok: false, reason: `path traversal 不被允許：${targetPath}` }
  if (rel.includes('\0')) return { ok: false, reason: '路徑含非法字元。' }
  // Must stay inside snapshots dir for snapshot files, but generic check allows any project-relative
  // Ensure normalized still starts inside project (no leading /)
  if (rel.startsWith('/')) return { ok: false, reason: `路徑必須是 project-relative：${targetPath}` }
  // Project root sanity — must be non-empty if provided
  if (projectRoot && isAbsolutePath(projectRoot) && projectRoot.includes('..')) {
    return { ok: false, reason: 'projectRoot 不合法。' }
  }
  return { ok: true, normalized: rel }
}

export function snapshotFilePath(pluginId: string): string {
  const safe = pluginId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'plugin'
  return `${SNAPSHOT_DIR}/${safe}.json`
}

// ── Snapshot creation ─────────────────────────────────────────────────

export type CreateSnapshotInput = {
  pluginId: string
  source: SnapshotSource
  resolvedVersion?: string
  resolvedCommit?: string
  rawManifest: unknown
  rawContentForHash?: string
  projectRoot: string
  /** Reuse the catalog validation result when available; do not reparse. */
  contract?: PluginContractResult
}

export async function createResolvedSnapshot(input: CreateSnapshotInput): Promise<PluginResolvedSnapshot | { error: string }> {
  const pluginId = input.pluginId.trim().slice(0, 220)
  if (!pluginId) return { error: 'pluginId 必填。' }
  const contract: PluginContractResult = input.contract ?? parseOpenDesignPluginManifest(input.rawManifest)
  if (!contract.ok) return { error: contract.reason }

  const requested = contract.kind === 'v1' ? [...contract.manifest.capabilities] : []
  const contentText = input.rawContentForHash ?? canonicalJson(input.rawManifest)
  const contentHash = await sha256Hex(contentText)
  const fingerprint = await fingerprintCapabilities(requested)

  const relPath = snapshotFilePath(pluginId)
  const validated = validateProjectRelativePath(input.projectRoot, relPath)
  if (!validated.ok) return { error: validated.reason }

  // Validate sourcePath itself is project-relative / not traversal
  const srcChecked = validateProjectRelativePath(input.projectRoot, input.source.sourcePath)
  if (!srcChecked.ok) return { error: `sourcePath 錯誤：${srcChecked.reason}` }

  const now = new Date().toISOString()
  const snapshot: PluginResolvedSnapshot = {
    version: SNAPSHOT_VERSION,
    snapshotId: `${pluginId}@${contentHash.slice(0, 12)}`,
    pluginId,
    source: {
      sourcePath: srcChecked.normalized,
      sourceUrl: input.source.sourceUrl?.slice(0, 500),
      upstreamCommit: input.source.upstreamCommit?.slice(0, 80),
      recordId: input.source.recordId?.slice(0, 180),
    },
    resolvedVersion: input.resolvedVersion?.slice(0, 80),
    resolvedCommit: input.resolvedCommit?.slice(0, 80),
    contentHash,
    capabilityFingerprint: fingerprint,
    requestedCapabilities: requested,
    grantedCapabilities: [],
    grantDecisions: [],
    createdAt: now,
    updatedAt: now,
    projectRelativePath: validated.normalized,
    contractKind: contract.kind,
    specVersion: contract.kind === 'v1' ? contract.manifest.specVersion : null,
    credentialRefs: [],
  }
  return snapshot
}

export function needsReapproval(old: PluginResolvedSnapshot, next: { contentHash: string; fingerprint: string }): boolean {
  return old.contentHash !== next.contentHash || old.capabilityFingerprint !== next.fingerprint
}

export function revokeGrants(snapshot: PluginResolvedSnapshot): PluginResolvedSnapshot {
  return {
    ...snapshot,
    grantedCapabilities: [],
    grantScope: undefined,
    revokedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function grantCapabilities(
  snapshot: PluginResolvedSnapshot,
  toGrant: string[],
  scope: GrantScope,
): PluginResolvedSnapshot {
  const allowed = new Set(snapshot.requestedCapabilities)
  const sameScope = Boolean(
    snapshot.grantScope
    && snapshot.grantScope.runId === scope.runId
    && snapshot.grantScope.threadId === scope.threadId,
  )
  // Grants from another run/thread must never bleed into the new scope.
  const existing = sameScope ? snapshot.grantedCapabilities : []
  const granted = [...new Set([...existing, ...toGrant.filter((c) => allowed.has(c))])]
  return {
    ...snapshot,
    grantedCapabilities: granted,
    grantScope: { ...scope },
    grantDecisions: [
      ...snapshot.grantDecisions,
      ...toGrant.filter((capability) => allowed.has(capability)).map((capability) => ({
        capability,
        granted: true,
        decidedAt: new Date().toISOString(),
        runId: scope.runId,
        threadId: scope.threadId,
      })),
    ],
    grantedAt: new Date().toISOString(),
    revokedAt: undefined,
    updatedAt: new Date().toISOString(),
    credentialRefs: snapshot.credentialRefs,
  }
}

export function isCapabilityGranted(snapshot: PluginResolvedSnapshot, capability: string, scope: GrantScope): boolean {
  if (!snapshot.grantedCapabilities.includes(capability) || !snapshot.grantScope) return false
  if (snapshot.grantScope.runId && snapshot.grantScope.runId !== scope.runId) return false
  if (snapshot.grantScope.threadId && snapshot.grantScope.threadId !== scope.threadId) return false
  return true
}

export function isSnapshotPathValid(projectRoot: string, relPath: string): boolean {
  const r = validateProjectRelativePath(projectRoot, relPath)
  if (!r.ok) return false
  // Snapshot must live under SNAPSHOT_DIR
  return r.normalized.startsWith(SNAPSHOT_DIR + '/') || r.normalized === SNAPSHOT_DIR
}

// For activity / projection redaction check
export function snapshotContainsNoRawToken(snapshot: PluginResolvedSnapshot): boolean {
  const json = JSON.stringify(snapshot)
  // Heuristic: raw token patterns — long base64-ish or sk- / ghp_ etc
  if (/sk-[a-zA-Z0-9]{20,}/.test(json)) return false
  if (/ghp_[a-zA-Z0-9]{30,}/.test(json)) return false
  if (/"token"\s*:\s*"[^"]{20,}"/.test(json)) return false
  return true
}
